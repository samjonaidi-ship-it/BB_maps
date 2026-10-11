// BB_Maps | src/routes/admin.test.js | v1.0.0 | 2026-10-10 | BB
// POST /admin/version takes refresh-maps.sh's lock, so a manual publish and a
// monthly refresh never overwrite each other's version.json (Devin, PR #18).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEY = 'test-admin-key';
let app;
let dir;
let file;
let lock;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bbadmin-'));
  file = join(dir, 'version.json');
  lock = join(dir, '.refresh.lock');
  process.env.VERSION_FILE = file;
  process.env.ADMIN_API_KEY = KEY;
  const { adminRoute } = await import('./admin.js');
  app = Fastify();
  await app.register(adminRoute, { prefix: '/admin' });
});

after(async () => {
  await app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const post = (version) => app.inject({
  method: 'POST', url: '/admin/version',
  headers: { authorization: `Bearer ${KEY}` },
  payload: { version },
});

test('a running refresh holds the lock -> 409, version.json untouched', async () => {
  writeFileSync(file, JSON.stringify({ version: '20261006' }));
  mkdirSync(lock);
  try {
    const res = await post('20261009');
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(readFileSync(file, 'utf-8')).version, '20261006');
    assert.equal(existsSync(lock), true, 'the refresh keeps its lock');
  } finally {
    rmdirSync(lock);
  }
});

test('no refresh running -> 200, written, lock released', async () => {
  const res = await post('20261009');
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(readFileSync(file, 'utf-8')).version, '20261009');
  assert.equal(existsSync(lock), false);
});
