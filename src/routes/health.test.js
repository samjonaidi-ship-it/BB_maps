// BB_Maps | src/routes/health.test.js | v1.0.0 | 2026-10-10 | BB
// /health/release — Better Stack pages Sam when this goes non-2xx, so a
// stalled monthly map release is caught (more than 40 days since the last one).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DAY_MS = 24 * 60 * 60_000;
let app;
let dir;
let file;
let releaseAge;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bbhealth-'));
  file = join(dir, 'version.json');
  process.env.VERSION_FILE = file;
  const mod = await import('./health.js');
  releaseAge = mod.releaseAge;
  app = Fastify();
  await app.register(mod.healthRoute);
});

after(async () => {
  await app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const manifest = (daysAgo) => ({
  version: '20261010', build: '20261010',
  updatedAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
});

test('fresh release -> 200 ok, not cached', async () => {
  writeFileSync(file, JSON.stringify(manifest(3)));
  const res = await app.inject({ url: '/health/release' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'ok');
  assert.equal(res.json().ageDays, 3);
  assert.equal(res.json().build, '20261010');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('release over 40 days old -> 503 stale', async () => {
  writeFileSync(file, JSON.stringify(manifest(41)));
  const res = await app.inject({ url: '/health/release' });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().status, 'stale');
  assert.equal(res.json().ageDays, 41);
});

test('missing or unreadable version.json -> 503', async () => {
  rmSync(file, { force: true });
  assert.equal((await app.inject({ url: '/health/release' })).statusCode, 503);
  writeFileSync(file, '{not json');
  assert.equal((await app.inject({ url: '/health/release' })).statusCode, 503);
});

test('releaseAge boundaries: 35-day gap between first Sundays is fine, 40 ok, 41 stale', () => {
  const now = new Date('2026-12-06T10:00:00Z'); // first Sunday of December, 2 AM PT
  const at = (days) => ({ version: 'x', updatedAt: new Date(now.getTime() - days * DAY_MS).toISOString() });
  assert.equal(releaseAge(at(35), now).ok, true);
  assert.equal(releaseAge(at(40), now).ok, true);
  assert.equal(releaseAge(at(41), now).ok, false);
  assert.equal(releaseAge({ version: '0.0.0' }, now).ok, false);
  assert.equal(releaseAge({ version: 'x' }, now).ok, false);
  assert.equal(releaseAge(null, now).ok, false);
});
