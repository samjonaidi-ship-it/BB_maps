FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# pmtiles CLI for the self-seeding boot extract (docker-entrypoint.sh)
FROM node:20-slim AS pmtiles
ADD https://github.com/protomaps/go-pmtiles/releases/download/v1.30.3/go-pmtiles_1.30.3_Linux_x86_64.tar.gz /tmp/pmtiles.tar.gz
RUN mkdir -p /tmp/pmtiles && tar -xzf /tmp/pmtiles.tar.gz -C /tmp/pmtiles

FROM node:20-slim

WORKDIR /app

# Install wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=pmtiles /tmp/pmtiles/pmtiles /usr/local/bin/pmtiles
COPY package.json ./
COPY src ./src
COPY docker-entrypoint.sh refresh-maps.sh ./
RUN chmod +x docker-entrypoint.sh refresh-maps.sh /usr/local/bin/pmtiles

# Create data directories
RUN mkdir -p /data/tiles /data/styles /data/fonts /data/sprites /data/assets

ENV NODE_ENV=production
ENV PORT=8080
# Keep the version manifest on the persistent volume so the entrypoint's writer
# and admin.js's reader agree on Railway (no docker-compose there). Without this
# admin.js defaulted to /app/data/version.json (ephemeral, wiped each deploy),
# so /admin/version always reported 0.0.0 — the dead-man's-switch (audit E).
ENV VERSION_FILE=/data/version.json
# Every route reads the same /data paths refresh-maps.sh writes. Without these the
# routes fell back to /app/data (resolve('data/...')) and a bare image served 404s
# for a release it had just built (Devin, PR #11). Railway sets the same values.
ENV DATA_DIR=/data TILES_DIR=/data/tiles FONTS_DIR=/data/fonts SPRITES_DIR=/data/sprites ASSETS_DIR=/data/assets STYLES_DIR=/data/styles

EXPOSE 8080

CMD ["./docker-entrypoint.sh"]
