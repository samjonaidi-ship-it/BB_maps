#!/bin/sh
# BB_Maps | refresh-maps.sh | v1.2.0 | 2026-10-10 | BB
# v1.2.0 (Devin round 1): every replaced piece, version.json included, is kept
#         in $DATA_DIR/.prev and ALL of them are restored on any failure or
#         kill; the release commits with one rename. A republish of the same
#         build gets its own version (BUILD.1, BUILD.2 ...) so phones re-download
#         a coverage change; the manifest carries "build" for the pinned check.
#         version.json is parsed before it is published.
# One map release = tiles + fonts + sprites + offline-pack tars + version.json,
# built together so phones never mix a new tile pack with old assets.
#
#   1. resolve the Protomaps build: TILES_BUILD_DATE=YYYYMMDD pins one;
#      unset / "auto" takes the newest build that exists (today, then back
#      REFRESH_LOOKBACK_DAYS days - Protomaps keeps only ~6 daily builds).
#   2. build everything in $DATA_DIR/.staging and verify it (tile file is a
#      readable PMTiles archive over TILES_MIN_BYTES, font + sprite sentinels).
#   3. swap each piece into place (the old one kept in .prev), write
#      version.json LAST, then commit by renaming .prev away. Any failure or
#      kill during the swap puts every old piece back, version.json included.
#
# A failure at any step leaves the live files and version.json as they were,
# so a phone can never be told "new version" while it would download the old
# file (the v1.3.0 entrypoint bumped version.json before its background
# extract had even finished). Exit 0 = new release live; 1 = nothing changed.
# Called by docker-entrypoint.sh on a fresh volume and by src/refresh-scheduler.js.

set -u

DATA_DIR="${DATA_DIR:-/data}"
TILES_DIR="${TILES_DIR:-$DATA_DIR/tiles}"
TILES_FILE="${TILES_FILE:-bay-area.pmtiles}"
TILES_BBOX="${TILES_BBOX:--122.6,36.4,-121.2,37.95}"
TILES_MAXZOOM="${TILES_MAXZOOM:-15}"
TILES_MIN_BYTES="${TILES_MIN_BYTES:-50000000}"
FONTS_DIR="${FONTS_DIR:-$DATA_DIR/fonts}"
SPRITES_DIR="${SPRITES_DIR:-$DATA_DIR/sprites}"
ASSETS_DIR="${ASSETS_DIR:-$DATA_DIR/assets}"
VERSION_FILE="${VERSION_FILE:-$DATA_DIR/version.json}"
BUILD_BASE_URL="${BUILD_BASE_URL:-https://build.protomaps.com}"
ASSETS_URL="${ASSETS_URL:-https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.tar.gz}"
PMTILES_BIN="${PMTILES_BIN:-pmtiles}"
REFRESH_LOOKBACK_DAYS="${REFRESH_LOOKBACK_DAYS:-7}"
REFRESH_TODAY="${REFRESH_TODAY:-$(date -u +%Y-%m-%d)}"
FONT_STACKS="Noto Sans Regular:Noto Sans Medium:Noto Sans Italic"

STAGE="$DATA_DIR/.staging"
LOCK="$DATA_DIR/.refresh.lock"
PREV="$DATA_DIR/.prev"
PIECES="fonts sprites fonts.tar sprites.tar tiles version.json"

log() { echo "[refresh] $*"; }

# Live path of each release piece.
live_of() {
  case "$1" in
    fonts) echo "$FONTS_DIR" ;;
    sprites) echo "$SPRITES_DIR" ;;
    fonts.tar|sprites.tar) echo "$ASSETS_DIR/$1" ;;
    tiles) echo "$TILES_DIR/$TILES_FILE" ;;
    version.json) echo "$VERSION_FILE" ;;
  esac
}

# Put back every piece this swap replaced (or remove what it newly created), so
# the live files are exactly the previous release again.
rollback() {
  [ -d "$PREV" ] || return 0
  for name in $PIECES; do
    live=$(live_of "$name")
    if [ -e "$PREV/$name" ]; then
      rm -rf "$live" && mv "$PREV/$name" "$live" || log "ROLLBACK could not restore $name"
    elif [ -e "$PREV/$name.created" ]; then
      rm -rf "$live"
    fi
  done
  rm -rf "$PREV"
  log "rolled back - previous release restored"
}

mkdir -p "$DATA_DIR"
# One refresh at a time. A lock older than 3 h is a crashed run, not a live one.
if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then
  log "removing stale lock"; rmdir "$LOCK" 2>/dev/null
fi
if ! mkdir "$LOCK" 2>/dev/null; then log "another refresh is running - skipping"; exit 1; fi

SWAPPING=false
on_exit() {
  [ "$SWAPPING" = true ] && rollback
  rm -rf "$STAGE"
  rmdir "$LOCK" 2>/dev/null
}
trap on_exit EXIT
trap 'exit 1' INT TERM HUP

# A run killed mid-swap (SIGKILL, power loss) left .prev behind: restore it.
rm -rf "$PREV.done"
if [ -d "$PREV" ]; then log "found an interrupted release - restoring the previous one"; rollback; fi

fail() {
  if [ "$SWAPPING" = true ]; then
    log "FAILED mid-swap: $* - restoring the previous release"
  else
    log "FAILED: $* - live map and version.json unchanged"
  fi
  exit 1
}

# ── 1. which build ──────────────────────────────────────────────────────
BUILD=""
case "${TILES_BUILD_DATE:-auto}" in
  ""|auto)
    # Epoch arithmetic + "@seconds": works with GNU and BusyBox date alike.
    TODAY_S=$(date -u -d "$REFRESH_TODAY" +%s) || fail "bad REFRESH_TODAY $REFRESH_TODAY"
    i=0
    while [ "$i" -le "$REFRESH_LOOKBACK_DAYS" ]; do
      d=$(date -u -d "@$((TODAY_S - i * 86400))" +%Y%m%d) || fail "date arithmetic"
      # Any failure (404 or a network blip) falls back a day: an older build is
      # still a valid release, and the log shows which days were skipped.
      if wget -q --spider "$BUILD_BASE_URL/$d.pmtiles"; then BUILD="$d"; break; fi
      log "build $d not reachable - trying the day before"
      i=$((i + 1))
    done
    [ -n "$BUILD" ] || fail "no Protomaps build in the last $REFRESH_LOOKBACK_DAYS days"
    ;;
  *) BUILD="$TILES_BUILD_DATE" ;;
esac
log "build $BUILD bbox=$TILES_BBOX maxzoom=$TILES_MAXZOOM"

# ── 2. stage + verify ───────────────────────────────────────────────────
rm -rf "$STAGE"
mkdir -p "$STAGE/fonts" "$STAGE/sprites" "$STAGE/assets" || fail "cannot create $STAGE"

"$PMTILES_BIN" extract "$BUILD_BASE_URL/$BUILD.pmtiles" "$STAGE/$TILES_FILE" \
  --bbox="$TILES_BBOX" --maxzoom="$TILES_MAXZOOM" || fail "tile extract of $BUILD"
TILE_BYTES=$(wc -c < "$STAGE/$TILES_FILE" | tr -d ' ')
[ "$TILE_BYTES" -ge "$TILES_MIN_BYTES" ] || fail "tile file only $TILE_BYTES bytes (< $TILES_MIN_BYTES)"
"$PMTILES_BIN" show "$STAGE/$TILES_FILE" > /dev/null 2>&1 || fail "tile file is not a readable PMTiles archive"

wget -q -O "$STAGE/assets.tar.gz" "$ASSETS_URL" || fail "assets download"
mkdir -p "$STAGE/src"
tar -xzf "$STAGE/assets.tar.gz" -C "$STAGE/src" || fail "assets unpack"
SRC=$(find "$STAGE/src" -mindepth 1 -maxdepth 1 -type d | head -1)
OLD_IFS="$IFS"; IFS=':'
for stack in $FONT_STACKS; do
  [ -d "$SRC/fonts/$stack" ] && cp -r "$SRC/fonts/$stack" "$STAGE/fonts/"
done
IFS="$OLD_IFS"
cp "$SRC"/sprites/v4/* "$STAGE/sprites/" 2>/dev/null
# Sentinels: an upstream layout change makes the copies above fail silently.
[ -f "$STAGE/fonts/Noto Sans Regular/0-255.pbf" ] || fail "fonts missing from assets (upstream layout change?)"
[ -f "$STAGE/sprites/light.json" ] || fail "sprites missing from assets (upstream layout change?)"
(cd "$STAGE/fonts" && tar -cf "$STAGE/assets/fonts.tar" .) || fail "fonts.tar"
(cd "$STAGE/sprites" && tar -cf "$STAGE/assets/sprites.tar" .) || fail "sprites.tar"
FONTS_TAR_BYTES=$(wc -c < "$STAGE/assets/fonts.tar" | tr -d ' ')
SPRITES_TAR_BYTES=$(wc -c < "$STAGE/assets/sprites.tar" | tr -d ' ')

# ── 3. swap, then publish the version ───────────────────────────────────
# A republish of the same build (coverage change, manual run) still has to look
# new to phones, which compare version strings: BUILD, then BUILD.1, BUILD.2...
PREV_VERSION=""
[ -f "$VERSION_FILE" ] && PREV_VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$VERSION_FILE" | head -1)
case "$PREV_VERSION" in
  "$BUILD") VERSION="$BUILD.1" ;;
  "$BUILD".*)
    n=${PREV_VERSION#"$BUILD".}
    case "$n" in ''|*[!0-9]*) n=0 ;; esac
    VERSION="$BUILD.$((n + 1))" ;;
  *) VERSION="$BUILD" ;;
esac

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TOTAL=$((TILE_BYTES + FONTS_TAR_BYTES + SPRITES_TAR_BYTES))
cat > "$STAGE/version.json" <<VJSON || fail "version.json build"
{
  "version": "$VERSION",
  "build": "$BUILD",
  "updatedAt": "$NOW",
  "bbox": "$TILES_BBOX",
  "totalSize": $TOTAL,
  "tiles": {
    "$TILES_FILE": { "bytes": $TILE_BYTES, "maxzoom": $TILES_MAXZOOM }
  },
  "assets": {
    "fonts.tar": { "bytes": $FONTS_TAR_BYTES },
    "sprites.tar": { "bytes": $SPRITES_TAR_BYTES }
  }
}
VJSON
node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$STAGE/version.json" \
  || fail "version.json is not valid JSON"

# Every mv is a same-volume rename (Railway and Compose mount ONE volume at
# /data). Each live piece moves to .prev before its replacement moves in; any
# failure from here on, or a kill, restores every piece from .prev (on_exit).
# version.json goes LAST, so phones never see a version whose files are not all
# live. A directory swap is two renames, so /fonts and /sprites can 404 for the
# microseconds between them; MapLibre retries, and the swap runs at 2 AM PT.
mkdir -p "$TILES_DIR" "$ASSETS_DIR" "$(dirname "$FONTS_DIR")" "$(dirname "$SPRITES_DIR")" "$(dirname "$VERSION_FILE")" \
  || fail "cannot create the live directories"
rm -rf "$PREV"
mkdir "$PREV" || fail "cannot create $PREV"
SWAPPING=true
install_piece() { # name staged-path
  live=$(live_of "$1")
  if [ -e "$live" ]; then
    mv "$live" "$PREV/$1" || return 1
  else
    : > "$PREV/$1.created" || return 1
  fi
  mv "$2" "$live"
}
install_piece fonts "$STAGE/fonts" || fail "fonts swap"
install_piece sprites "$STAGE/sprites" || fail "sprites swap"
install_piece fonts.tar "$STAGE/assets/fonts.tar" || fail "fonts.tar swap"
install_piece sprites.tar "$STAGE/assets/sprites.tar" || fail "sprites.tar swap"
install_piece tiles "$STAGE/$TILES_FILE" || fail "tile swap"
install_piece version.json "$STAGE/version.json" || fail "version.json publish"

# Commit point: one rename. After it, nothing is rolled back.
mv "$PREV" "$PREV.done" || fail "commit"
SWAPPING=false
rm -rf "$PREV.done"
# Kept for the v1.3.0 entrypoint's bbox|date marker (harmless if unused).
printf '%s' "$TILES_BBOX|$BUILD" > "$TILES_DIR/.tiles-seed"
log "published version $VERSION (build $BUILD; tiles $TILE_BYTES B, fonts.tar $FONTS_TAR_BYTES B, sprites.tar $SPRITES_TAR_BYTES B)"
exit 0
