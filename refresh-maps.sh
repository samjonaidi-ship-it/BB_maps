#!/bin/sh
# BB_Maps | refresh-maps.sh | v1.0.0 | 2026-10-10 | BB
# One map release = tiles + fonts + sprites + offline-pack tars + version.json,
# built together so phones never mix a new tile pack with old assets.
#
#   1. resolve the Protomaps build: TILES_BUILD_DATE=YYYYMMDD pins one;
#      unset / "auto" takes the newest build that exists (today, then back
#      REFRESH_LOOKBACK_DAYS days - Protomaps keeps only ~6 daily builds).
#   2. build everything in $DATA_DIR/.staging and verify it (tile file is a
#      readable PMTiles archive over TILES_MIN_BYTES, font + sprite sentinels).
#   3. swap each piece into place, then write version.json LAST (tmp + mv).
#
# Any failure before step 3 leaves the live files and version.json untouched,
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

log() { echo "[refresh] $*"; }

mkdir -p "$DATA_DIR"
# One refresh at a time. A lock older than 3 h is a crashed run, not a live one.
if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then
  log "removing stale lock"; rmdir "$LOCK" 2>/dev/null
fi
if ! mkdir "$LOCK" 2>/dev/null; then log "another refresh is running - skipping"; exit 1; fi
trap 'rm -rf "$STAGE"; rmdir "$LOCK" 2>/dev/null' EXIT

fail() { log "FAILED: $* - live map and version.json unchanged"; exit 1; }

# ── 1. which build ──────────────────────────────────────────────────────
BUILD=""
case "${TILES_BUILD_DATE:-auto}" in
  ""|auto)
    i=0
    while [ "$i" -le "$REFRESH_LOOKBACK_DAYS" ]; do
      d=$(date -u -d "$REFRESH_TODAY -$i day" +%Y%m%d) || fail "bad REFRESH_TODAY $REFRESH_TODAY"
      if wget -q --spider "$BUILD_BASE_URL/$d.pmtiles"; then BUILD="$d"; break; fi
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
# Each mv is a same-volume rename, so a request mid-swap reads the old or the
# new file, never a partial one.
mkdir -p "$TILES_DIR" "$ASSETS_DIR" "$(dirname "$FONTS_DIR")" "$(dirname "$SPRITES_DIR")"
mv -f "$STAGE/$TILES_FILE" "$TILES_DIR/$TILES_FILE" || fail "tile swap"
swap_dir() {
  rm -rf "$1.old"
  [ -d "$1" ] && mv "$1" "$1.old"
  mv "$2" "$1" || { [ -d "$1.old" ] && mv "$1.old" "$1"; return 1; }
  rm -rf "$1.old"
}
swap_dir "$FONTS_DIR" "$STAGE/fonts" || fail "fonts swap"
swap_dir "$SPRITES_DIR" "$STAGE/sprites" || fail "sprites swap"
mv -f "$STAGE/assets/fonts.tar" "$ASSETS_DIR/fonts.tar" || fail "fonts.tar swap"
mv -f "$STAGE/assets/sprites.tar" "$ASSETS_DIR/sprites.tar" || fail "sprites.tar swap"
# Kept for the v1.3.0 entrypoint's bbox|date marker (harmless if unused).
printf '%s' "$TILES_BBOX|$BUILD" > "$TILES_DIR/.tiles-seed"

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TOTAL=$((TILE_BYTES + FONTS_TAR_BYTES + SPRITES_TAR_BYTES))
mkdir -p "$(dirname "$VERSION_FILE")"
cat > "$VERSION_FILE.tmp" <<VJSON
{
  "version": "$BUILD",
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
mv -f "$VERSION_FILE.tmp" "$VERSION_FILE" || fail "version.json write"
log "published version $BUILD (tiles $TILE_BYTES B, fonts.tar $FONTS_TAR_BYTES B, sprites.tar $SPRITES_TAR_BYTES B)"
exit 0
