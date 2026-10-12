/**
 * /terrain — elevation (DEM) tile proxy for 3D terrain
 *
 * Proxies AWS Open Data "Terrain Tiles" in Terrarium encoding, which MapLibre
 * reads as a raster-dem source (encoding: 'terrarium') to raise hills and
 * valleys. No API key, no cost. Zoom 0-15 (the dataset stops at 15; MapLibre
 * overzooms past that).
 *
 * Source: https://registry.opendata.aws/terrain-tiles/
 * License: free with attribution (Mapzen terrain sources, incl. USGS 3DEP / SRTM)
 */
import { request as httpRequest } from 'undici';
import { parseSatelliteRateLimit } from './satellite.js';

const TERRARIUM_BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
export const TERRAIN_MAX_ZOOM = 15;

// Same tile-hungry shape as /satellite (a 3D globe pulls both), so it gets its
// own per-IP counter at the same default, parsed with the same guard.
export const TERRAIN_RATE_LIMIT_MAX = parseSatelliteRateLimit(process.env.TERRAIN_RATE_LIMIT_MAX);

let tileRequestCount = 0;

export async function terrainRoute(fastify) {
  // GET /terrain/:z/:x/:y.png  (Terrarium order: x before y)
  fastify.get('/:z/:x/:y', {
    config: { rateLimit: { max: TERRAIN_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { z, x, y } = request.params;

    // Digits only (parseInt would accept '163abc' and mint duplicate cache keys).
    const yNum = y.replace(/\.png$/, '');
    if (![z, x, yNum].every((v) => /^\d+$/.test(v))) {
      return reply.code(400).send({ error: 'Invalid tile coordinates' });
    }
    const zoom = parseInt(z, 10);
    const col = parseInt(x, 10);
    const row = parseInt(yNum, 10);

    if (isNaN(zoom) || zoom < 0 || zoom > TERRAIN_MAX_ZOOM) {
      return reply.code(400).send({ error: `Zoom must be 0-${TERRAIN_MAX_ZOOM}` });
    }
    const n = 2 ** zoom;
    if (isNaN(row) || isNaN(col) || row < 0 || col < 0 || row >= n || col >= n) {
      return reply.code(400).send({ error: 'Invalid tile coordinates' });
    }

    try {
      const { statusCode, headers, body } = await httpRequest(`${TERRARIUM_BASE}/${zoom}/${col}/${row}.png`, {
        method: 'GET',
        headersTimeout: 10000,
        bodyTimeout: 15000,
      });

      tileRequestCount++;

      if (statusCode !== 200) {
        await body.dump();
        // S3 answers 403, not 404, for a key the dataset lacks: both are a stable miss.
        if (statusCode === 404 || statusCode === 403) {
          reply.header('Cache-Control', 'public, max-age=86400');
          return reply.code(404).send({ error: 'No elevation at this location/zoom' });
        }
        fastify.log.warn({ statusCode, z, x: col, y: row }, 'Terrain tiles returned non-200');
        reply.header('Cache-Control', 'public, max-age=60');
        return reply.code(502).send({ error: 'Terrain upstream error' });
      }

      if (!String(headers['content-type'] || '').startsWith('image/png')) {
        await body.dump();
        fastify.log.warn({ contentType: headers['content-type'], z, x: col, y: row }, 'Terrain tile was not a PNG');
        return reply.code(502).send({ error: 'Terrain upstream error' });
      }
      const buf = Buffer.from(await body.arrayBuffer());
      // Elevation does not change: cache for a week, serve stale for a month.
      reply
        .header('Content-Type', 'image/png')
        .header('Content-Length', buf.length)
        .header('Cache-Control', 'public, max-age=604800, stale-while-revalidate=2592000')
        .header('X-Tile-Source', 'aws-terrain-tiles-terrarium');

      return reply.send(buf);
    } catch (err) {
      fastify.log.error({ err, z, x: col, y: row }, 'Terrain tile request failed');
      return reply.code(503).send({ error: 'Terrain unavailable' });
    }
  });

  // GET /terrain/usage — internal counter
  fastify.get('/usage', async (request, reply) => reply.send({ tileRequests: tileRequestCount }));
}
