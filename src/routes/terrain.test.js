// BB_Maps | src/routes/terrain.test.js | v1.0.0 | 2026-10-11 | BB
// /terrain proxies AWS Terrarium elevation tiles for the CalExp5 globe's 3D
// terrain: x/y order, zoom 0-15, its own per-IP limit like /satellite.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';

const GLOBAL_MAX = 600; // index.js default
let app;
let prevDispatcher;
let mod;
const upstreamPaths = [];

before(async () => {
  prevDispatcher = getGlobalDispatcher();
  const agent = new MockAgent();
  agent.disableNetConnect();
  const pool = agent.get('https://s3.amazonaws.com');
  pool.intercept({ path: '/elevation-tiles-prod/terrarium/9/1/2.png', method: 'GET' })
    .reply(404, 'nope').persist();
  pool.intercept({ path: '/elevation-tiles-prod/terrarium/9/1/3.png', method: 'GET' })
    .reply(403, '<Error>AccessDenied</Error>').persist();
  pool.intercept({ path: '/elevation-tiles-prod/terrarium/9/1/4.png', method: 'GET' })
    .reply(200, '<html>oops</html>', { headers: { 'content-type': 'text/html' } }).persist();
  pool.intercept({ path: /\/elevation-tiles-prod\/terrarium\//, method: 'GET' })
    .reply((opts) => { upstreamPaths.push(opts.path); return { statusCode: 200, data: Buffer.from([0x89, 0x50, 0x4e, 0x47]), responseOptions: { headers: { 'content-type': 'image/png' } } }; })
    .persist();
  setGlobalDispatcher(agent);

  mod = await import('./terrain.js');
  app = Fastify();
  await app.register(rateLimit, { max: GLOBAL_MAX, timeWindow: '1 minute' });
  await app.register(mod.terrainRoute, { prefix: '/terrain' });
});

after(async () => {
  await app?.close();
  setGlobalDispatcher(prevDispatcher);
});

test('proxies z/x/y in Terrarium order and caches for a week', async () => {
  const res = await app.inject({ url: '/terrain/10/163/396.png' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/png');
  assert.match(res.headers['cache-control'], /max-age=604800/);
  assert.ok(upstreamPaths.includes('/elevation-tiles-prod/terrarium/10/163/396.png'), upstreamPaths.join(','));
});

test('rejects zoom past 15 and coordinates outside the zoom grid', async () => {
  assert.equal((await app.inject({ url: '/terrain/16/0/0.png' })).statusCode, 400);
  assert.equal((await app.inject({ url: '/terrain/2/4/0.png' })).statusCode, 400);
  assert.equal((await app.inject({ url: '/terrain/2/0/-1.png' })).statusCode, 400);
  assert.equal((await app.inject({ url: '/terrain/x/0/0.png' })).statusCode, 400);
  assert.equal((await app.inject({ url: '/terrain/10/163abc/396.png' })).statusCode, 400);
  assert.equal((await app.inject({ url: '/terrain/10/0163/396.png' })).statusCode, 400);
  assert.equal((await app.inject({ url: '/terrain/10/163/396abc.png' })).statusCode, 400);
});

test('an upstream 404 stays a cacheable 404', async () => {
  const res = await app.inject({ url: '/terrain/9/1/2.png' });
  assert.equal(res.statusCode, 404);
  assert.match(res.headers['cache-control'], /max-age=86400/);
});

test('S3 403 for a missing key is a cacheable miss, not an uncached 502', async () => {
  const res = await app.inject({ url: '/terrain/9/1/3.png' });
  assert.equal(res.statusCode, 404);
  assert.match(res.headers['cache-control'], /max-age=86400/);
});

test('a 200 that is not a PNG is never served as a week-cached tile', async () => {
  const res = await app.inject({ url: '/terrain/9/1/4.png' });
  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(String(res.headers['cache-control']), /604800/);
});

test('terrain has its own limit above the shared 600', async () => {
  assert.equal(mod.TERRAIN_RATE_LIMIT_MAX, 3000);
  const res = await app.inject({ url: '/terrain/4/1/1.png' });
  assert.equal(res.headers['x-ratelimit-limit'], '3000');
});
