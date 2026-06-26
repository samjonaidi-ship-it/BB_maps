/**
 * /admin — Management API for Control Tower integration
 *
 * Provides version manifest, usage stats, and administrative endpoints
 * called by Bridge/CT for fleet management.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { getSatelliteUsage } from './satellite.js';

const VERSION_FILE = process.env.VERSION_FILE || resolve('data/version.json');

// In-memory request counters
const counters = {
  tiles: 0,
  geocode: 0,
  satellite: 0,
  fonts: 0,
  sprites: 0,
  styles: 0,
  startedAt: new Date().toISOString(),
};

export async function adminRoute(fastify) {
  // Request counting hook
  fastify.addHook('onResponse', (request, reply, done) => {
    const path = request.url;
    if (path.startsWith('/tiles')) counters.tiles++;
    else if (path.startsWith('/geocode')) counters.geocode++;
    else if (path.startsWith('/satellite')) counters.satellite++;
    else if (path.startsWith('/fonts')) counters.fonts++;
    else if (path.startsWith('/sprites')) counters.sprites++;
    else if (path.startsWith('/styles')) counters.styles++;
    done();
  });

  // GET /admin/version — tile version manifest
  fastify.get('/version', async (request, reply) => {
    if (!existsSync(VERSION_FILE)) {
      return reply.send({
        version: '0.0.0',
        updatedAt: null,
        tiles: {},
      });
    }

    const content = await readFile(VERSION_FILE, 'utf-8');
    reply.send(JSON.parse(content));
  });

  // POST /admin/version — update version manifest (called by cron after tile rebuild)
  fastify.post('/version', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const adminKey = process.env.ADMIN_API_KEY;

    if (adminKey && authHeader !== `Bearer ${adminKey}`) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { version, tiles } = request.body || {};

    if (!version) {
      return reply.code(400).send({ error: 'version is required' });
    }

    const manifest = {
      version,
      updatedAt: new Date().toISOString(),
      tiles: tiles || {},
    };

    await writeFile(VERSION_FILE, JSON.stringify(manifest, null, 2));
    reply.send({ ok: true, manifest });
  });

  // GET /admin/usage — request counters for CT dashboard
  fastify.get('/usage', async (request, reply) => {
    const satellite = getSatelliteUsage();
    reply.send({
      ...counters,
      satellite: satellite.tileRequests,
      uptime: Math.floor((Date.now() - new Date(counters.startedAt).getTime()) / 1000),
    });
  });

  // POST /admin/usage/reset — reset counters
  fastify.post('/usage/reset', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const adminKey = process.env.ADMIN_API_KEY;

    if (adminKey && authHeader !== `Bearer ${adminKey}`) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    counters.tiles = 0;
    counters.geocode = 0;
    counters.satellite = 0;
    counters.fonts = 0;
    counters.sprites = 0;
    counters.styles = 0;
    counters.startedAt = new Date().toISOString();

    reply.send({ ok: true, reset: counters.startedAt });
  });
}
