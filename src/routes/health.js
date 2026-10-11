/**
 * Health check endpoints
 *
 * /health — basic liveness (always 200 if server is up)
 * /health/ready — readiness (checks Photon connectivity + tile file existence)
 * /health/release — 503 when the live map release is over RELEASE_MAX_AGE_DAYS
 *   old, so a stalled monthly refresh pages Sam (Better Stack status monitor)
 */
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request as httpRequest } from 'undici';

const TILES_DIR = process.env.TILES_DIR || resolve('data/tiles');
const PHOTON_URL = process.env.PHOTON_URL || 'http://photon:2322';
// Same file /admin/version serves.
const VERSION_FILE = process.env.VERSION_FILE || resolve('data/version.json');
// Releases run the first Sunday of each month: at most 35 days apart. 40 leaves
// 5 days of the scheduler's 6-hourly retries before it counts as stalled.
export const RELEASE_MAX_AGE_DAYS = 40;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Is the live release fresh enough?
 * @param {object|null} manifest - parsed version.json, null when missing/unreadable
 * @param {Date} now
 * @returns {{ok: boolean, reason: string, ageDays: number|null}}
 */
export function releaseAge(manifest, now) {
  if (!manifest?.version || manifest.version === '0.0.0') return { ok: false, reason: 'no release', ageDays: null };
  const builtAt = Date.parse(manifest.updatedAt);
  if (!Number.isFinite(builtAt)) return { ok: false, reason: 'release has no build time', ageDays: null };
  const ageDays = Math.floor((now.getTime() - builtAt) / DAY_MS);
  return ageDays > RELEASE_MAX_AGE_DAYS
    ? { ok: false, reason: `release is ${ageDays} days old (limit ${RELEASE_MAX_AGE_DAYS})`, ageDays }
    : { ok: true, reason: 'fresh', ageDays };
}

export async function healthRoute(fastify) {
  // GET /health — liveness probe
  fastify.get('/health', async (request, reply) => {
    reply.send({
      status: 'ok',
      service: 'bb-maps',
      timestamp: new Date().toISOString(),
    });
  });

  // GET /health/ready — readiness probe
  fastify.get('/health/ready', async (request, reply) => {
    const checks = {
      tiles: false,
      photon: false,
    };

    // Check tile files exist
    if (existsSync(TILES_DIR)) {
      const files = readdirSync(TILES_DIR).filter(f => f.endsWith('.pmtiles'));
      checks.tiles = files.length > 0;
    }

    // Check Photon is reachable
    try {
      const { statusCode } = await httpRequest(`${PHOTON_URL}/api?q=test&limit=1`, {
        method: 'GET',
        headersTimeout: 3000,
        bodyTimeout: 3000,
      });
      checks.photon = statusCode === 200;
    } catch {
      checks.photon = false;
    }

    const allReady = Object.values(checks).every(Boolean);

    reply
      .code(allReady ? 200 : 503)
      .send({
        status: allReady ? 'ready' : 'degraded',
        checks,
        timestamp: new Date().toISOString(),
      });
  });

  // GET /health/release — map release age (Better Stack alerts on non-2xx)
  fastify.get('/health/release', async (request, reply) => {
    let manifest = null;
    try { manifest = JSON.parse(await readFile(VERSION_FILE, 'utf-8')); } catch { manifest = null; }
    const { ok, reason, ageDays } = releaseAge(manifest, new Date());
    reply
      .code(ok ? 200 : 503)
      .header('cache-control', 'no-store')
      .send({
        status: ok ? 'ok' : 'stale',
        reason,
        build: manifest?.build ?? manifest?.version ?? null,
        updatedAt: manifest?.updatedAt ?? null,
        ageDays,
        maxAgeDays: RELEASE_MAX_AGE_DAYS,
      });
  });
}
