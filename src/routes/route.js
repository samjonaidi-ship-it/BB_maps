/**
 * /route — OSRM driving-route proxy (P2, 2026-07-02 maps-parity)
 *
 * GET /route/v1?from=lat,lng&to=lat,lng
 *   → { path: [{lat, lng}, …], distanceMeters, durationSeconds }
 *
 * Proxies the OSRM route API (OSRM_URL env; defaults to the public demo
 * server — same interim pattern as PHOTON_URL, self-hosting is an env swap).
 * OSRM speaks lon,lat — the query params are lat,lng (matching every other
 * BB surface) and are flipped here, guarded the same way as the Bridge's
 * clients/osrm.js routeBetween.
 *
 * TripMapView consumes only the overview path — overview=full, geojson.
 * Responses are cached in-memory for 1h (routes over fixed road networks
 * are stable) and marked cacheable for clients.
 */
import { request as httpRequest } from 'undici';

const OSRM_URL = (process.env.OSRM_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const cache = new Map(); // key → { at, payload }

function parseLatLng(value) {
  if (typeof value !== 'string') return null;
  const [latStr, lngStr] = value.split(',');
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export async function routeRoute(fastify) {
  fastify.get('/v1', async (request, reply) => {
    const from = parseLatLng(request.query.from);
    const to = parseLatLng(request.query.to);

    if (!from || !to) {
      return reply.code(400).send({ error: 'Params "from" and "to" must be "lat,lng"' });
    }

    // Round to ~1m so nearby repeats share a cache entry
    const key = [from.lat.toFixed(5), from.lng.toFixed(5), to.lat.toFixed(5), to.lng.toFixed(5)].join(',');
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return reply
        .header('Cache-Control', 'public, max-age=3600')
        .header('X-Route-Cache', 'hit')
        .send(hit.payload);
    }

    // OSRM coordinate order is lon,lat
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

    try {
      const { statusCode, body } = await httpRequest(url, {
        method: 'GET',
        headersTimeout: 10000,
        bodyTimeout: 10000,
      });

      if (statusCode !== 200) {
        await body.dump();
        fastify.log.warn({ statusCode, from, to }, 'OSRM returned non-200');
        return reply.code(502).send({ error: 'Routing upstream error' });
      }

      const data = await body.json();
      if (data.code !== 'Ok' || !data.routes?.length) {
        fastify.log.warn({ code: data.code, from, to }, 'OSRM found no route');
        return reply.code(502).send({ error: `Routing failed: ${data.code || 'no route'}` });
      }

      const route = data.routes[0];
      const payload = {
        // GeoJSON coordinates are [lng, lat] — flip to the app-wide shape
        path: (route.geometry?.coordinates || []).map(([lng, lat]) => ({ lat, lng })),
        distanceMeters: route.distance,
        durationSeconds: route.duration,
      };

      cache.set(key, { at: Date.now(), payload });
      if (cache.size > CACHE_MAX) {
        cache.delete(cache.keys().next().value); // Map preserves insertion order
      }

      return reply
        .header('Cache-Control', 'public, max-age=3600')
        .header('X-Route-Cache', 'miss')
        .send(payload);
    } catch (err) {
      fastify.log.error({ err, from, to }, 'OSRM request failed');
      return reply.code(503).send({ error: 'Routing unavailable' });
    }
  });
}
