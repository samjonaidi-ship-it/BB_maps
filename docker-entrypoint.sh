#!/bin/sh
# BB_Maps | docker-entrypoint.sh | v1.0.0 | 2026-07-02 | BB
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

exec node src/index.js
