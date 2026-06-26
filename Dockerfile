FROM node:20-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-slim

WORKDIR /app

# Install wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Create data directories
RUN mkdir -p /data/tiles /data/styles /data/fonts /data/sprites

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "src/index.js"]
