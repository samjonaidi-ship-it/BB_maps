#!/bin/sh
# BB_Maps | docker-entrypoint.sh | v2.0.0 | 2026-10-10 | BB
# v2.0.0: the tile seed, version manifest and asset seed moved into
#         refresh-maps.sh, which builds them as ONE release and writes
#         version.json only after every piece is in place. v1.3.0 bumped
#         version.json right after starting a BACKGROUND extract, using the old
#         file's size and even when the extract then failed - phones recorded the
#         new version against the old file and never updated again. Updates now
#         run monthly from src/refresh-scheduler.js (first Sunday 2:00 AM PT);
#         this script only seeds a fresh volume, blocking, so node never starts
#         with nothing to serve. TILES_BUILD_DATE unset/"auto" = newest build.
# v1.3.0: TILES_BBOX widened to greater NorCal; re-extract on bbox/date change.
# v1.2.0: write data/version.json from TILES_BUILD_DATE after seeding.
# v1.1.0: also self-seed fonts, sprites, and the offline-pack tars.
# Seed is BEST-EFFORT: a failed seed must not crash-loop the service -
# /health/ready reports tiles:false and the scheduler retries within the hour.

DATA_DIR="${DATA_DIR:-/data}"
TILES_DIR="${TILES_DIR:-$DATA_DIR/tiles}"
TILES_FILE="${TILES_FILE:-bay-area.pmtiles}"
ASSETS_DIR="${ASSETS_DIR:-$DATA_DIR/assets}"
VERSION_FILE="${VERSION_FILE:-$DATA_DIR/version.json}"

if [ ! -f "$TILES_DIR/$TILES_FILE" ] || [ ! -f "$ASSETS_DIR/fonts.tar" ] || [ ! -f "$VERSION_FILE" ]; then
  echo "[seed] fresh or incomplete volume - building the first map release (blocking)"
  sh ./refresh-maps.sh || echo "[seed] first release FAILED - the monthly scheduler retries"
else
  echo "[seed] map release present - updates run from the monthly scheduler"
fi

exec node src/index.js
