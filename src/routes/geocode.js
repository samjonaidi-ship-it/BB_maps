/**
 * /geocode — Photon geocoder proxy
 *
 * Proxies requests to the Photon geocoding engine (self-hosted via Mapstack).
 * Photon provides OSM-based address autocomplete, forward, and reverse geocoding.
 *
 * Endpoints:
 *   GET /geocode?q=...&bbox=...&limit=5     → forward geocode (autocomplete)
 *   GET /geocode/reverse?lat=...&lon=...    → reverse geocode
 */
import { request as httpRequest } from 'undici';

const PHOTON_URL = process.env.PHOTON_URL || 'http://photon:2322';

// Bay Area bounding box (default restriction for relevance)
const BAY_AREA_BBOX = '-122.52,36.95,-121.73,37.82';

export async function geocodeRoute(fastify) {
  // GET /geocode?q=...&bbox=...&limit=5&lang=en&osm_tag=key:value[,key:value]
  fastify.get('/', async (request, reply) => {
    const { q, bbox, limit = '5', lang = 'en', lat, lon, osm_tag } = request.query;

    if (!q || q.trim().length < 2) {
      return reply.code(400).send({ error: 'Query "q" must be at least 2 characters' });
    }

    const requestedLimit = Math.min(parseInt(limit, 10) || 5, 20);
    const params = new URLSearchParams({
      q: q.trim(),
      // Over-fetch a little so the post-dedup below can still fill the
      // requested count (P3 autocomplete polish).
      limit: String(Math.min(requestedLimit * 2, 20)),
      lang,
    });

    // P3: Photon osm_tag filter passthrough (e.g. osm_tag=place,building:yes,
    // or negative filters like osm_tag=!highway). Photon accepts repeated
    // osm_tag params — comma-separate to send several.
    if (osm_tag) {
      String(osm_tag).split(',').map(t => t.trim()).filter(Boolean)
        .forEach(t => params.append('osm_tag', t));
    }

    // Add bounding box for geographic bias (bbox=minLon,minLat,maxLon,maxLat)
    const effectiveBbox = bbox || BAY_AREA_BBOX;
    if (effectiveBbox) {
      const [minLon, minLat, maxLon, maxLat] = effectiveBbox.split(',');
      params.set('bbox', `${minLon},${minLat},${maxLon},${maxLat}`);
    }

    // Location bias (optional — improves relevance when user location known)
    if (lat && lon) {
      params.set('lat', lat);
      params.set('lon', lon);
    }

    try {
      const { statusCode, body } = await httpRequest(
        `${PHOTON_URL}/api?${params.toString()}`,
        { method: 'GET', headersTimeout: 5000, bodyTimeout: 5000 }
      );

      if (statusCode !== 200) {
        await body.dump();
        fastify.log.warn({ statusCode, q }, 'Photon returned non-200');
        return reply.code(502).send({ error: 'Geocoder upstream error' });
      }

      const raw = await body.json();

      // Transform Photon GeoJSON into our simplified response shape
      const mapped = (raw.features || []).map(f => ({
        displayName: formatDisplayName(f.properties),
        street: f.properties.street || null,
        houseNumber: f.properties.housenumber || null,
        city: f.properties.city || f.properties.town || f.properties.village || null,
        state: f.properties.state || null,
        postcode: f.properties.postcode || null,
        country: f.properties.country || null,
        lat: f.geometry?.coordinates?.[1] ?? null,
        lon: f.geometry?.coordinates?.[0] ?? null,
        type: f.properties.type || f.properties.osm_value || null,
        osmId: f.properties.osm_id || null,
      }));

      // P3 de-dup: Photon often returns the same address as several OSM
      // objects (house node + building way). Keep the first per displayName
      // + ~11m coordinate cell, then cap to the requested count.
      const seen = new Set();
      const results = mapped.filter(r => {
        const key = `${r.displayName}|${r.lat?.toFixed(4)},${r.lon?.toFixed(4)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, requestedLimit);

      reply
        .header('Cache-Control', 'public, max-age=300')
        .send({ results, count: results.length });
    } catch (err) {
      fastify.log.error({ err, q }, 'Photon request failed');
      return reply.code(503).send({ error: 'Geocoder unavailable' });
    }
  });

  // GET /geocode/reverse?lat=...&lon=...
  fastify.get('/reverse', async (request, reply) => {
    const { lat, lon, limit = '1', lang = 'en' } = request.query;

    if (!lat || !lon) {
      return reply.code(400).send({ error: 'Both "lat" and "lon" are required' });
    }

    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      limit: String(Math.min(parseInt(limit, 10) || 1, 5)),
      lang,
    });

    try {
      const { statusCode, body } = await httpRequest(
        `${PHOTON_URL}/reverse?${params.toString()}`,
        { method: 'GET', headersTimeout: 5000, bodyTimeout: 5000 }
      );

      if (statusCode !== 200) {
        await body.dump();
        fastify.log.warn({ statusCode, lat, lon }, 'Photon reverse returned non-200');
        return reply.code(502).send({ error: 'Geocoder upstream error' });
      }

      const raw = await body.json();

      const results = (raw.features || []).map(f => ({
        displayName: formatDisplayName(f.properties),
        street: f.properties.street || null,
        houseNumber: f.properties.housenumber || null,
        city: f.properties.city || f.properties.town || f.properties.village || null,
        state: f.properties.state || null,
        postcode: f.properties.postcode || null,
        country: f.properties.country || null,
        lat: f.geometry?.coordinates?.[1] ?? null,
        lon: f.geometry?.coordinates?.[0] ?? null,
        type: f.properties.type || f.properties.osm_value || null,
        osmId: f.properties.osm_id || null,
      }));

      reply
        .header('Cache-Control', 'public, max-age=3600')
        .send({ results, count: results.length });
    } catch (err) {
      fastify.log.error({ err, lat, lon }, 'Photon reverse request failed');
      return reply.code(503).send({ error: 'Geocoder unavailable' });
    }
  });
}

/**
 * Format a Photon properties object into a human-readable display name.
 */
function formatDisplayName(props) {
  const parts = [];

  if (props.housenumber && props.street) {
    parts.push(`${props.housenumber} ${props.street}`);
  } else if (props.street) {
    parts.push(props.street);
  } else if (props.name) {
    parts.push(props.name);
  }

  const city = props.city || props.town || props.village;
  if (city) parts.push(city);
  if (props.state) parts.push(props.state);
  if (props.postcode) parts.push(props.postcode);

  return parts.join(', ') || props.name || 'Unknown';
}
