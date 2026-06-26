# BB_Maps

Self-hosted map infrastructure for CalExp5 — tile serving, geocoding, satellite imagery, and map assets.

## Architecture

```
┌─────────── BB_Maps (Railway Service) ─────────────────────────────────┐
│                                                                        │
│  TILE SERVING (PMTiles, HTTP range requests):                          │
│  GET /tiles/:filename         ← Vector tiles (206 partial content)     │
│                                                                        │
│  GEOCODING (Photon, OSM-based):                                        │
│  GET /geocode?q=...&bbox=...  ← Forward geocoding / autocomplete       │
│  GET /geocode/reverse?lat=...&lon=...  ← Reverse geocoding             │
│                                                                        │
│  SATELLITE (Esri World Imagery proxy):                                 │
│  GET /satellite/:z/:y/:x      ← Proxied satellite tiles                │
│                                                                        │
│  MAP ASSETS:                                                           │
│  GET /styles/:name.json       ← MapLibre style definitions             │
│  GET /fonts/:stack/:range.pbf ← Font glyphs (PBF)                     │
│  GET /sprites/:name           ← Icon sprites (PNG + JSON)              │
│                                                                        │
│  ADMIN:                                                                │
│  GET  /admin/version          ← Tile version manifest                  │
│  POST /admin/version          ← Update manifest (after tile rebuild)   │
│  GET  /admin/usage            ← Request counters (CT dashboard)        │
│  POST /admin/usage/reset      ← Reset counters                         │
│  GET  /health                 ← Liveness probe                         │
│  GET  /health/ready           ← Readiness probe (checks Photon+tiles)  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/samjonaidi-ship-it/BB_Maps.git
cd BB_Maps
npm install

# 2. Copy environment template
cp .env.example .env

# 3. Start with Docker Compose (includes Photon geocoder)
docker compose up

# 4. Or run standalone (without Photon)
PHOTON_URL=http://localhost:2322 node src/index.js
```

## Docker Compose Stack

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `bb-maps` | Built from Dockerfile | 8080 | Fastify API server |
| `photon` | `codingkiwi/mapstack-photon` | 2322 | OSM geocoder (Bay Area) |

## Data Directories

Place tile/asset files in these directories (volume-mounted in Docker):

```
data/
├── tiles/          ← PMTiles files (bay-area.pmtiles, etc.)
├── styles/         ← MapLibre style JSON (dark.json, light.json)
├── fonts/          ← PBF glyph ranges (Noto Sans Regular/0-255.pbf)
├── sprites/        ← Sprite sheets (dark.png, dark.json, dark@2x.png)
└── version.json    ← Auto-generated version manifest
```

## API Reference

### Tiles (PMTiles HTTP Range Requests)

```bash
# Get tile data (MapLibre sends Range headers automatically)
curl -H "Range: bytes=0-1024" http://localhost:8080/tiles/bay-area.pmtiles

# Check file size
curl -I http://localhost:8080/tiles/bay-area.pmtiles
```

### Geocoding (Photon)

```bash
# Forward geocode (autocomplete)
curl "http://localhost:8080/geocode?q=123+main+st&limit=5"

# Reverse geocode
curl "http://localhost:8080/geocode/reverse?lat=37.7749&lon=-122.4194"
```

### Satellite (Esri proxy)

```bash
# Get satellite tile
curl http://localhost:8080/satellite/14/6331/2621 --output tile.jpg
```

## Environment Variables

See `.env.example` for all available configuration options.

## Deployment (Railway)

1. Connect this repo to Railway
2. Set environment variables (PORT, PHOTON_URL, ADMIN_API_KEY, etc.)
3. Attach a volume for `/data` (tiles + assets)
4. Photon runs as a companion service in the same Railway project

## Integration with CalExp5

CalExp5's provider registry (Ship 13a) resolves map capabilities at runtime.
BB_Maps is the backend for `bb_maps` tile/geocoder/satellite providers configured via CT feature flags.

## License

Proprietary — Bainbridge internal use only.
