// BB_Maps | src/routes/assets.test.js | v1.0.0 | 2026-10-10 | BB
// /assets — offline-pack tars. refresh-maps.sh replaces them under the same URL
// each month, so they must not sit in a cache for a day: no-cache + an ETag that
// changes when the file does, 304 when it has not. Real temp files, as in
// tiles.test.js.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtempSync, writeFileSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app;
let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bbassets-'));
  writeFileSync(join(dir, 'fonts.tar'), Buffer.alloc(2048, 1));
  process.env.ASSETS_DIR = dir;
  const { assetsRoute } = await import('./assets.js');
  app = Fastify();
  await app.register(assetsRoute, { prefix: '/assets' });
});

after(async () => {
  await app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('GET: no-cache, ETag, full body', async () => {
  const res = await app.inject({ url: '/assets/fonts.tar' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'public, no-cache');
  assert.ok(res.headers.etag);
  assert.equal(res.rawPayload.length, 2048);
});

test('unchanged file -> 304; a monthly swap (new file renamed in) -> new ETag, 200', async () => {
  const etag = (await app.inject({ url: '/assets/fonts.tar' })).headers.etag;
  const same = await app.inject({ url: '/assets/fonts.tar', headers: { 'if-none-match': etag } });
  assert.equal(same.statusCode, 304);
  const weakList = await app.inject({ url: '/assets/fonts.tar', headers: { 'if-none-match': `"zz", W/${etag}` } });
  assert.equal(weakList.statusCode, 304, 'weak ETag in a list still matches');

  writeFileSync(join(dir, 'fonts.tar.new'), Buffer.alloc(3000, 2));
  renameSync(join(dir, 'fonts.tar.new'), join(dir, 'fonts.tar'));
  const swapped = await app.inject({ url: '/assets/fonts.tar', headers: { 'if-none-match': etag } });
  assert.equal(swapped.statusCode, 200);
  assert.notEqual(swapped.headers.etag, etag);
  assert.equal(swapped.rawPayload.length, 3000);
});

test('HEAD: length, no body; bad names rejected', async () => {
  const head = await app.inject({ method: 'HEAD', url: '/assets/fonts.tar' });
  assert.equal(head.statusCode, 200);
  assert.equal(head.rawPayload.length, 0);
  assert.equal((await app.inject({ url: '/assets/x.json' })).statusCode, 400);
  assert.equal((await app.inject({ url: '/assets/missing.tar' })).statusCode, 404);
});
