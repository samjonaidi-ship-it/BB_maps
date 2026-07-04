#!/bin/sh
# BB_Maps | docker-entrypoint.sh | v1.2.0 | 2026-07-03 | BB
# v1.2.0: write data/version.json from TILES_BUILD_DATE after seeding so
#         /admin/version reflects real tile builds (was a dead-man's switch —
#         a re-seed never propagated to clients' checkForUpdate). Audit E.
# v1.1.0: also self-seed fonts, sprites, and the offline-pack tars
#         (fonts.tar / sprites.tar) from the protomaps/basemaps-assets repo —
#         /fonts, /sprites, and /assets served 404s before this because the
#         volume dirs were empty. Best-effort, skipped when already present.
# Self-seeding boot: on a fresh volume, extract the Bay Area vector tiles
# straight from the Protomaps daily build (HTTP range reads — only the bbox
# subset transfers, ~125MB). Reproducible, no artifact shipping: version
# bumps are an env change (TILES_BUILD_DATE) + volume file removal or a new
# filename. Skipped entirely when the tile file already exists or the env
# is unset (local dev with ./data mounted keeps working unchanged).
# Seed is BEST-EFFORT: a transient extract failure must not crash-loop the
# service — /health/ready reports tiles:false and the next restart retries.

TILES_DIR="${TILES_DIR:-/data/tiles}"
TILES_FILE="${TILES_FILE:-bay-area.pmtiles}"
TILES_BBOX="${TILES_BBOX:--122.52,36.95,-121.73,37.82}"
TILES_MAXZOOM="${TILES_MAXZOOM:-15}"

if [ -n "$TILES_BUILD_DATE" ] && [ ! -f "$TILES_DIR/$TILES_FILE" ]; then
  echo "[seed] $TILES_DIR/$TILES_FILE missing — extracting from build.protomaps.com/$TILES_BUILD_DATE.pmtiles"
  mkdir -p "$TILES_DIR"
  # ATOMIC SEED (audit 2026-07-03): extract to a .partial then mv into place.
  # Extracting straight to the final path meant a mid-extract kill (Railway
  # deploy cutover / OOM — a ~125MB network extract is a long window) left a
  # TRUNCATED file at the final path; the next boot's `[ ! -f ]` sees it, skips
  # re-seeding FOREVER, and every client (online + pack) gets corrupt tiles
  # while /health/ready still reports tiles:true. mv on the same filesystem is
  # atomic, so a partial .partial can never masquerade as a complete file.
  TMP_TILE="$TILES_DIR/$TILES_FILE.partial"
  rm -f "$TMP_TILE"
  if pmtiles extract "https://build.protomaps.com/$TILES_BUILD_DATE.pmtiles" \
    "$TMP_TILE" \
    --bbox="$TILES_BBOX" \
    --maxzoom="$TILES_MAXZOOM"; then
    mv -f "$TMP_TILE" "$TILES_DIR/$TILES_FILE"
    echo "[seed] extract complete: $(ls -la "$TILES_DIR/$TILES_FILE")"
  else
    echo "[seed] EXTRACT FAILED — booting without tiles (ready probe reports degraded); partial file removed"
    rm -f "$TMP_TILE"
  fi
else
  echo "[seed] tiles present or TILES_BUILD_DATE unset — skipping seed"
fi

# ── Version manifest (audit 2026-07-03 E) ───────────────────────────────
# CalExp5's checkForUpdate polls /admin/version, but nothing wrote version.json,
# so a tile re-seed (bump TILES_BUILD_DATE + remove the volume file) was
# invisible to clients — stale offline packs never re-downloaded. Derive the
# manifest deterministically from TILES_BUILD_DATE so a build bump propagates
# the moment the new tiles land. Rewritten only when the recorded version drifts
# from TILES_BUILD_DATE (idempotent across restarts).
VERSION_FILE="${VERSION_FILE:-/data/version.json}"
if [ -n "$TILES_BUILD_DATE" ] && [ -f "$TILES_DIR/$TILES_FILE" ]; then
  RECORDED=""
  [ -f "$VERSION_FILE" ] && RECORDED=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$VERSION_FILE" | head -1)
  if [ "$RECORDED" != "$TILES_BUILD_DATE" ]; then
    TILE_BYTES=$(wc -c < "$TILES_DIR/$TILES_FILE" 2>/dev/null | tr -d ' ')
    NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    mkdir -p "$(dirname "$VERSION_FILE")"
    cat > "$VERSION_FILE" <<VJSON
{
  "version": "$TILES_BUILD_DATE",
  "updatedAt": "$NOW",
  "tiles": {
    "$TILES_FILE": { "bytes": ${TILE_BYTES:-0}, "maxzoom": $TILES_MAXZOOM }
  }
}
VJSON
    echo "[version] wrote manifest version=$TILES_BUILD_DATE bytes=${TILE_BYTES:-0}"
  else
    echo "[version] manifest already at $TILES_BUILD_DATE — no change"
  fi
fi

# ── Fonts / sprites / offline-pack tars ─────────────────────────────────
# One repo tarball download populates everything the style needs:
#   FONTS_DIR/<fontstack>/*.pbf        → /fonts/{fontstack}/{range}.pbf
#   SPRITES_DIR/{light,dark}*.{png,json} → /sprites/{name}
#   ASSETS_DIR/{fonts,sprites}.tar     → /assets/*.tar (CalExp5 OPFS packs)
# Best-effort like the tile seed; re-runs only when fonts.tar is missing.
FONTS_DIR="${FONTS_DIR:-/data/fonts}"
SPRITES_DIR="${SPRITES_DIR:-/data/sprites}"
ASSETS_DIR="${ASSETS_DIR:-/data/assets}"
FONT_STACKS="Noto Sans Regular:Noto Sans Medium:Noto Sans Italic"

if [ ! -f "$ASSETS_DIR/fonts.tar" ]; then
  echo "[seed] assets missing — fetching protomaps/basemaps-assets"
  TMP="$(mktemp -d)"
  if wget -q -O "$TMP/assets.tar.gz" "https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.tar.gz" \
    && tar -xzf "$TMP/assets.tar.gz" -C "$TMP"; then
    SRC="$TMP/basemaps-assets-main"
    mkdir -p "$FONTS_DIR" "$SPRITES_DIR" "$ASSETS_DIR"
    OLD_IFS="$IFS"; IFS=':'
    for stack in $FONT_STACKS; do
      [ -d "$SRC/fonts/$stack" ] && cp -r "$SRC/fonts/$stack" "$FONTS_DIR/"
    done
    IFS="$OLD_IFS"
    # Sprites route serves flat names — copy the v4 set to the dir root.
    cp "$SRC"/sprites/v4/* "$SPRITES_DIR/" 2>/dev/null
    # Sentinel check (audit fix): if the upstream repo layout changes, the
    # copies above fail SILENTLY — creating tars from empty dirs would then
    # freeze the broken state forever (the fonts.tar guard never re-runs the
    # seed). Only tar when the expected content actually landed.
    if [ -f "$FONTS_DIR/Noto Sans Regular/0-255.pbf" ] && [ -f "$SPRITES_DIR/light.json" ]; then
      (cd "$FONTS_DIR" && tar -cf "$ASSETS_DIR/fonts.tar" .)
      (cd "$SPRITES_DIR" && tar -cf "$ASSETS_DIR/sprites.tar" .)
      echo "[seed] assets complete: $(ls -la "$ASSETS_DIR")"
    else
      echo "[seed] ASSETS SEED INCOMPLETE — expected files missing (upstream layout change?); tars not created, will retry next boot"
    fi
  else
    echo "[seed] ASSETS SEED FAILED — fonts/sprites/packs stay empty until next restart"
    rm -f "$ASSETS_DIR/fonts.tar" "$ASSETS_DIR/sprites.tar"
  fi
  rm -rf "$TMP"
else
  echo "[seed] assets present — skipping asset seed"
fi

exec node src/index.js
