/**
 * /satellite — Esri World Imagery tile proxy
 *
 * Proxies satellite imagery requests to Esri's free World Imagery basemap.
 * Adds caching headers and usage tracking. No API key required (free tier).
 *
 * Source: https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer
 * Resolution: ~30cm urban, ~1m rural
 * License: Free with attribution ("Powered by Esri")
 */
import { request as httpRequest } from 'undici';

const ESRI_BASE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';

// Simple in-memory usage counter (reset on restart; persisted via /admin/usage)
let tileRequestCount = 0;

export function resetSatelliteUsage() {
  tileRequestCount = 0;
}

export async function satelliteRoute(fastify) {
  // GET /satellite/:z/:y/:x.jpg
  fastify.get('/:z/:y/:x', async (request, reply) => {
    const { z, y, x } = request.params;

    const zoom = parseInt(z, 10);
    const row = parseInt(y, 10);
    const col = parseInt(x.replace(/\.\w+$/, ''), 10); // strip extension

    // Validate zoom level (Esri supports 0-23, restrict to 0-19 for perf)
    if (isNaN(zoom) || zoom < 0 || zoom > 19) {
      return reply.code(400).send({ error: 'Zoom must be 0-19' });
    }

    if (isNaN(row) || isNaN(col) || row < 0 || col < 0) {
      return reply.code(400).send({ error: 'Invalid tile coordinates' });
    }

    const esriUrl = `${ESRI_BASE}/${zoom}/${row}/${col}`;

    try {
      const { statusCode, headers, body } = await httpRequest(esriUrl, {
        method: 'GET',
        headersTimeout: 10000,
        bodyTimeout: 15000,
      });

      tileRequestCount++;

      if (statusCode !== 200) {
        await body.dump();
        // Esri returns 404 for missing tiles at high zoom in ocean/wilderness
        if (statusCode === 404) {
          reply.header('Cache-Control', 'public, max-age=86400');
          return reply.code(404).send({ error: 'No imagery at this location/zoom' });
        }
        fastify.log.warn({ statusCode, z, y, x: col }, 'Esri returned non-200');
        return reply.code(502).send({ error: 'Satellite upstream error' });
      }

      const contentType = headers['content-type'] || 'image/jpeg';
      const imageBuffer = Buffer.from(await body.arrayBuffer());

      reply
        .header('Content-Type', contentType)
        .header('Content-Length', imageBuffer.length)
        .header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
        .header('X-Tile-Source', 'esri-world-imagery')
        .header('X-Attribution', 'Powered by Esri');

      return reply.send(imageBuffer);
    } catch (err) {
      fastify.log.error({ err, z, y, x: col }, 'Esri satellite request failed');
      return reply.code(503).send({ error: 'Satellite imagery unavailable' });
    }
  });

  // GET /satellite/usage — internal counter for CT dashboard
  fastify.get('/usage', async (request, reply) => {
    return reply.send({ tileRequests: tileRequestCount });
  });
}

export function getSatelliteUsage() {
  return { tileRequests: tileRequestCount };
}
