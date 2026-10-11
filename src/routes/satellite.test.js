// BB_Maps | src/routes/satellite.test.js | v1.0.0 | 2026-10-11 | BB
// Imagery tiles get their own per-IP limit, above the 600/min every other
// route shares - a globe session needs hundreds of tiles a minute
// (REPORTS/GLOBE_TILE_DROPOUT_2026-10-11.md).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';

const GLOBAL_MAX = 600; // index.js default
let app;
let prevDispatcher;
let mod;

before(async () => {
  prevDispatcher = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  agent.get('https://server.arcgisonline.com')
    .intercept({ path: /\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/tile\//, method: 'GET' })
    .reply(200, Buffer.from([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } })
    .persist();
  setGlobalDispatcher(agent);

  mod = await import('./satellite.js');
  app = Fastify();
  await app.register(rateLimit, { max: GLOBAL_MAX, timeWindow: '1 minute' });
  await app.register(mod.satelliteRoute, { prefix: '/satellite' });
  app.get('/other', async () => ({ ok: true }));
});

after(async () => {
  await app?.close();
  setGlobalDispatcher(prevDispatcher);
});

test('satellite limit defaults above the shared 600', () => {
  assert.equal(mod.SATELLITE_RATE_LIMIT_MAX, 3000);
});

test('a mistyped env limit falls back to 3000 instead of breaking the limiter', () => {
  for (const raw of ['3,000', 'abc', '0', '-5', '12.5', 'unlimited']) {
    assert.equal(mod.parseSatelliteRateLimit(raw), 3000, raw);
  }
  assert.equal(mod.parseSatelliteRateLimit(undefined), 3000);
  assert.equal(mod.parseSatelliteRateLimit('5000'), 5000);
});

test('one client gets more than 600 tiles a minute, other routes keep their own bucket', async () => {
  const n = GLOBAL_MAX + 50;
  const statuses = {};
  for (let i = 0; i < n; i++) {
    const res = await app.inject({ url: `/satellite/5/${i % 32}/${Math.floor(i / 32)}` });
    statuses[res.statusCode] = (statuses[res.statusCode] || 0) + 1;
  }
  assert.deepEqual(statuses, { 200: n });

  // The tile burst did not spend the shared bucket the rest of BB_Maps uses.
  const other = await app.inject({ url: '/other' });
  assert.equal(other.statusCode, 200);
  assert.equal(other.headers['x-ratelimit-limit'], String(GLOBAL_MAX));
});

test('the satellite route is still limited, at its own max', async () => {
  const res = await app.inject({ url: '/satellite/4/1/1' });
  assert.equal(res.headers['x-ratelimit-limit'], String(mod.SATELLITE_RATE_LIMIT_MAX));
});
