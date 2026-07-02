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
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=pmtiles /tmp/pmtiles/pmtiles /usr/local/bin/pmtiles
COPY package.json ./
COPY src ./src
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh /usr/local/bin/pmtiles

# Create data directories
RUN mkdir -p /data/tiles /data/styles /data/fonts /data/sprites

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["./docker-entrypoint.sh"]
