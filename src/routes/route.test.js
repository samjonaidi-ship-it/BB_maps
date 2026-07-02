// BB_Maps | src/routes/route.test.js | v1.0.0 | 2026-07-02 | BB
// /route/v1 — OSRM proxy contract. A real local Fastify stub stands in for
// OSRM (no module mocking): asserts lat,lng → lon,lat flipping, the
// normalized response shape, the 1h cache, and input validation.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

let osrmStub;
let app;
let osrmCalls = [];

before(async () => {
  // Stub OSRM — records the coordinate string it was called with.
  osrmStub = Fastify();
  osrmStub.get('/route/v1/driving/:coords', async (req) => {
    osrmCalls.push(req.params.coords);
    if (req.params.coords.startsWith('0,0')) {
      return { code: 'NoRoute', routes: [] };
    }
    return {
      code: 'Ok',
      routes: [{
        distance: 4321.5,
        duration: 380.2,
        geometry: {
          type: 'LineString',
          coordinates: [[-121.97, 37.24], [-121.96, 37.25], [-121.95, 37.26]],
        },
      }],
    };
  });
  await osrmStub.listen({ port: 0, host: '127.0.0.1' });
  const { port } = osrmStub.server.address();
  process.env.OSRM_URL = `http://127.0.0.1:${port}`;

  // Import AFTER env is set — OSRM_URL is read at module load.
  const { routeRoute } = await import('./route.js');
  app = Fastify();
  await app.register(routeRoute, { prefix: '/route' });
});

after(async () => {
  await app?.close();
  await osrmStub?.close();
});

test('happy path — flips lat,lng to OSRM lon,lat and normalizes the shape', async () => {
  osrmCalls = [];
  const res = await app.inject({ url: '/route/v1?from=37.24,-121.97&to=37.26,-121.95' });
  assert.equal(res.statusCode, 200);

  // OSRM must receive lon,lat
  assert.equal(osrmCalls[0], '-121.97,37.24;-121.95,37.26');

  const body = res.json();
  assert.equal(body.distanceMeters, 4321.5);
  assert.equal(body.durationSeconds, 380.2);
  // GeoJSON [lng,lat] flipped back to {lat,lng}
  assert.deepEqual(body.path[0], { lat: 37.24, lng: -121.97 });
  assert.equal(body.path.length, 3);
  assert.equal(res.headers['x-route-cache'], 'miss');
  assert.match(res.headers['cache-control'], /max-age=3600/);
});

test('repeat request within TTL is served from cache (no second OSRM call)', async () => {
  osrmCalls = [];
  const res = await app.inject({ url: '/route/v1?from=37.24,-121.97&to=37.26,-121.95' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-route-cache'], 'hit');
  assert.equal(osrmCalls.length, 0);
  assert.equal(res.json().distanceMeters, 4321.5);
});

test('missing / malformed / out-of-range params → 400', async () => {
  for (const qs of [
    '',
    '?from=37.24,-121.97',
    '?from=abc&to=37.26,-121.95',
    '?from=37.24&to=37.26,-121.95',
    '?from=95,-121.97&to=37.26,-121.95',   // lat out of range
    '?from=37.24,-200&to=37.26,-121.95',   // lng out of range
  ]) {
    const res = await app.inject({ url: `/route/v1${qs}` });
    assert.equal(res.statusCode, 400, `expected 400 for "${qs}"`);
  }
});

test('OSRM NoRoute → 502 with the OSRM code', async () => {
  const res = await app.inject({ url: '/route/v1?from=0,0&to=1,1' });
  assert.equal(res.statusCode, 502);
  assert.match(res.json().error, /NoRoute/);
});
