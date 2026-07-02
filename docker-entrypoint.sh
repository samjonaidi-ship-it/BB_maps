#!/bin/sh
# BB_Maps | docker-entrypoint.sh | v1.1.0 | 2026-07-02 | BB
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
  if pmtiles extract "https://build.protomaps.com/$TILES_BUILD_DATE.pmtiles" \
    "$TILES_DIR/$TILES_FILE" \
    --bbox="$TILES_BBOX" \
    --maxzoom="$TILES_MAXZOOM"; then
    echo "[seed] extract complete: $(ls -la "$TILES_DIR/$TILES_FILE")"
  else
    echo "[seed] EXTRACT FAILED — booting without tiles (ready probe reports degraded); partial file removed"
    rm -f "$TILES_DIR/$TILES_FILE"
  fi
else
  echo "[seed] tiles present or TILES_BUILD_DATE unset — skipping seed"
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
    (cd "$FONTS_DIR" && tar -cf "$ASSETS_DIR/fonts.tar" .)
    (cd "$SPRITES_DIR" && tar -cf "$ASSETS_DIR/sprites.tar" .)
    echo "[seed] assets complete: $(ls -la "$ASSETS_DIR")"
  else
    echo "[seed] ASSETS SEED FAILED — fonts/sprites/packs stay empty until next restart"
    rm -f "$ASSETS_DIR/fonts.tar" "$ASSETS_DIR/sprites.tar"
  fi
  rm -rf "$TMP"
else
  echo "[seed] assets present — skipping asset seed"
fi

exec node src/index.js
