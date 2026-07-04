#!/bin/sh
# BB_Maps | docker-entrypoint.sh | v1.3.0 | 2026-07-04 | BB
# v1.3.0: TILES_BBOX widened to greater NorCal. The old tight box
#         (-122.52,36.95,-121.73,37.82) cut tile DATA off east of
#         Gilroy/Morgan Hill and south of Watsonville — crew on the BB fallback
#         map saw a blank void over real jobsites (property pins draw, but no
#         tiles under them). The seed now RE-EXTRACTS whenever the bbox OR the
#         build date changes (recorded in .tiles-seed), so a coverage change
#         self-applies on the next deploy — no manual volume-file delete. When a
#         tile file already exists the re-extract runs in the BACKGROUND: the
#         atomic .partial->mv keeps the OLD pack serving until the new one lands,
#         so a large multi-minute extract can never block node's boot / trip the
#         Railway healthcheck. A fresh volume (no file) still extracts blocking.
# v1.2.0: write data/version.json from TILES_BUILD_DATE after seeding so
#         /admin/version reflects real tile builds (was a dead-man's switch —
#         a re-seed never propagated to clients' checkForUpdate). Audit E.
# v1.1.0: also self-seed fonts, sprites, and the offline-pack tars
#         (fonts.tar / sprites.tar) from the protomaps/basemaps-assets repo —
#         /fonts, /sprites, and /assets served 404s before this because the
#         volume dirs were empty. Best-effort, skipped when already present.
# Self-seeding boot: extract the vector tiles straight from the Protomaps daily
# build (HTTP range reads — only the bbox subset transfers). Reproducible, no
# artifact shipping. Seed is BEST-EFFORT: a transient extract failure must not
# crash-loop the service — /health/ready reports tiles:false and the next
# restart retries.

TILES_DIR="${TILES_DIR:-/data/tiles}"
TILES_FILE="${TILES_FILE:-bay-area.pmtiles}"
# Greater-NorCal coverage: peninsula + coast -> Salinas / Monterey Bay (S), past
# Gilroy / Hollister (E), inner East Bay — Fremont / Livermore / Oakland (N).
# ~3x the old tight Bay-Area box. Override via the TILES_BBOX env if the service
# footprint grows further; a change here re-extracts automatically on deploy.
TILES_BBOX="${TILES_BBOX:--122.6,36.4,-121.2,37.95}"
TILES_MAXZOOM="${TILES_MAXZOOM:-15}"
# Records the (bbox|build-date) that produced the current tile file, so a change
# to either self-triggers a re-extract without a manual volume-file delete.
SEED_MARKER="$TILES_DIR/.tiles-seed"

# Extract the bbox subset of the Protomaps daily build to a .partial, then mv
# atomically into place, and record the seed key that produced it.
extract_tiles() {
  mkdir -p "$TILES_DIR"
  TMP_TILE="$TILES_DIR/$TILES_FILE.partial"
  rm -f "$TMP_TILE"
  if pmtiles extract "https://build.protomaps.com/$TILES_BUILD_DATE.pmtiles" \
    "$TMP_TILE" --bbox="$TILES_BBOX" --maxzoom="$TILES_MAXZOOM"; then
    mv -f "$TMP_TILE" "$TILES_DIR/$TILES_FILE"
    printf '%s' "$TILES_BBOX|$TILES_BUILD_DATE" > "$SEED_MARKER"
    echo "[seed] extract complete (bbox=$TILES_BBOX): $(ls -la "$TILES_DIR/$TILES_FILE")"
  else
    echo "[seed] EXTRACT FAILED — keeping existing tiles (if any); partial removed"
    rm -f "$TMP_TILE"
  fi
}

SEED_KEY="$TILES_BBOX|$TILES_BUILD_DATE"
RECORDED_KEY=""
[ -f "$SEED_MARKER" ] && RECORDED_KEY=$(cat "$SEED_MARKER" 2>/dev/null)
NEED_TILES=false
[ ! -f "$TILES_DIR/$TILES_FILE" ] && NEED_TILES=true
[ "$RECORDED_KEY" != "$SEED_KEY" ] && NEED_TILES=true

if [ -n "$TILES_BUILD_DATE" ] && [ "$NEED_TILES" = true ]; then
  if [ -f "$TILES_DIR/$TILES_FILE" ]; then
    # Existing tiles keep serving during the re-extract (atomic swap) → run it in
    # the BACKGROUND so a large multi-minute extract can't block node's boot.
    echo "[seed] seed key changed ($RECORDED_KEY -> $SEED_KEY) — re-extracting in BACKGROUND; current tiles serve meanwhile"
    extract_tiles &
  else
    # Fresh volume: nothing to serve, so extract blocking before node starts.
    echo "[seed] no tile file — extracting (blocking) from build.protomaps.com/$TILES_BUILD_DATE.pmtiles"
    extract_tiles
  fi
else
  echo "[seed] tiles present + seed key unchanged, or TILES_BUILD_DATE unset — skipping tile seed"
fi

# ── Version manifest (audit 2026-07-03 E) ───────────────────────────────
# CalExp5's checkForUpdate polls /admin/version, but nothing wrote version.json,
# so a tile re-seed was invisible to clients — stale offline packs never
# re-downloaded. Derive the manifest deterministically from TILES_BUILD_DATE so
# a build bump propagates. Rewritten only when the recorded version drifts from
# TILES_BUILD_DATE (idempotent across restarts). NOTE: a bbox-only widen keeps
# the same version — ONLINE clients pick up the new tiles automatically via the
# size+mtime ETag / If-Range; to push the wider pack to existing OFFLINE-pack
# users, bump TILES_BUILD_DATE too.
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
