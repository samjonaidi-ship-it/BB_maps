/**
 * /assets — offline pack asset bundles (fonts.tar, sprites.tar)
 *
 * CalExp5's tile-download-manager fetches `/api/maps/assets/fonts.tar` and
 * `/api/maps/assets/sprites.tar` for the OPFS offline packs — this route did
 * not exist (found in the 2026-07-02 parity audit: the client contract was
 * written against it but the server never grew the endpoint). Serves whole
 * .tar files from ASSETS_DIR with the same caching posture as /tiles.
 */
import { join, resolve } from 'node:path';
import { existsSync, createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const ASSETS_DIR = process.env.ASSETS_DIR || resolve('data/assets');

export async function assetsRoute(fastify) {
  fastify.route({
    method: ['GET', 'HEAD'],
    url: '/:filename',
    handler: async (request, reply) => {
      const { filename } = request.params;

      // Security: prevent path traversal; only .tar bundles live here.
      if (filename.includes('..') || filename.includes('/') || !filename.endsWith('.tar')) {
        return reply.code(400).send({ error: 'Invalid filename' });
      }

      const filePath = join(ASSETS_DIR, filename);
      if (!existsSync(filePath)) {
        return reply.code(404).send({ error: 'Asset bundle not found' });
      }

      const { size } = await stat(filePath);
      reply
        .header('Content-Type', 'application/x-tar')
        .header('Content-Length', size)
        .header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

      if (request.method === 'HEAD') return reply.send();
      return reply.send(createReadStream(filePath));
    },
  });
}
