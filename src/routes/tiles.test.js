// BB_Maps | src/routes/tiles.test.js | v1.0.0 | 2026-07-03 | BB
// /tiles — PMTiles range proxy. Covers the audit-E validator behavior: ETag on
// every response, 304 on a matching If-None-Match full GET, and the If-Range
// downgrade (stale validator → full 200 instead of a spliced 206). Uses a real
// temp file so fs.stat drives the ETag exactly as production.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app;
let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bbtiles-'));
  writeFileSync(join(dir, 'bay-area.pmtiles'), Buffer.alloc(4096, 7));
  process.env.TILES_DIR = dir;

  const { tilesRoute } = await import('./tiles.js');
  app = Fastify();
  await app.register(tilesRoute, { prefix: '/tiles' });
});

after(async () => {
  await app?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('full GET carries an ETag + Last-Modified', async () => {
  const res = await app.inject({ url: '/tiles/bay-area.pmtiles' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers.etag, 'ETag present');
  assert.ok(res.headers['last-modified'], 'Last-Modified present');
  assert.equal(res.headers['content-length'], '4096');
});

test('matching If-None-Match → 304', async () => {
  const first = await app.inject({ url: '/tiles/bay-area.pmtiles' });
  const etag = first.headers.etag;
  const res = await app.inject({
    url: '/tiles/bay-area.pmtiles',
    headers: { 'if-none-match': etag },
  });
  assert.equal(res.statusCode, 304);
  assert.equal(res.headers.etag, etag);
});

test('range request with matching If-Range → 206 slice', async () => {
  const head = await app.inject({ method: 'HEAD', url: '/tiles/bay-area.pmtiles' });
  const etag = head.headers.etag;
  const res = await app.inject({
    url: '/tiles/bay-area.pmtiles',
    headers: { range: 'bytes=0-99', 'if-range': etag },
  });
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers['content-range'], 'bytes 0-99/4096');
  assert.equal(res.headers['content-length'], '100');
});

test('range request with STALE If-Range → full 200 (no spliced bytes)', async () => {
  const res = await app.inject({
    url: '/tiles/bay-area.pmtiles',
    headers: { range: 'bytes=0-99', 'if-range': '"old-build-validator"' },
  });
  assert.equal(res.statusCode, 200, 'stale If-Range must serve the whole entity');
  assert.equal(res.headers['content-length'], '4096');
});

test('range request without If-Range → normal 206', async () => {
  const res = await app.inject({
    url: '/tiles/bay-area.pmtiles',
    headers: { range: 'bytes=10-19' },
  });
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers['content-range'], 'bytes 10-19/4096');
});
