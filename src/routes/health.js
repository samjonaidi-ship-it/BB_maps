/**
 * Health check endpoints
 *
 * /health — basic liveness (always 200 if server is up)
 * /health/ready — readiness (checks Photon connectivity + tile file existence)
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { request as httpRequest } from 'undici';

const TILES_DIR = process.env.TILES_DIR || resolve('data/tiles');
const PHOTON_URL = process.env.PHOTON_URL || 'http://photon:2322';

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
}
