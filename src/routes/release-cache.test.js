// BB_Maps | src/routes/release-cache.test.js | v1.0.0 | 2026-10-10 | BB
// Fonts and sprites are replaced in place by the monthly release
// (refresh-maps.sh) at URLs that never change, so they must not be cached
// `immutable` or for a week (Devin, PR #11): same 1-day policy as tiles.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';

const TILES_POLICY = 'public, max-age=86400, stale-while-revalidate=604800';
let dir;
let app;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bbmaps-cache-'));
  mkdirSync(join(dir, 'fonts', 'Noto Sans Regular'), { recursive: true });
  writeFileSync(join(dir, 'fonts', 'Noto Sans Regular', '0-255.pbf'), 'glyphs');
  mkdirSync(join(dir, 'sprites'));
  writeFileSync(join(dir, 'sprites', 'bb.json'), '{}');
  process.env.FONTS_DIR = join(dir, 'fonts');
  process.env.SPRITES_DIR = join(dir, 'sprites');

  // Import AFTER env is set — the dirs are read at module load.
  const { fontsRoute } = await import('./fonts.js');
  const { spritesRoute } = await import('./sprites.js');
  app = Fastify();
  await app.register(fontsRoute, { prefix: '/fonts' });
  await app.register(spritesRoute, { prefix: '/sprites' });
});

after(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

for (const [name, url] of [
  ['font glyphs', '/fonts/Noto%20Sans%20Regular/0-255.pbf'],
  ['font fallback', '/fonts/Missing%20Font/0-255.pbf'],
  ['sprites', '/sprites/bb.json'],
]) {
  test(`${name} are cached like tiles, never immutable`, async () => {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], TILES_POLICY);
  });
}
