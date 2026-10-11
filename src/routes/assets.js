/**
 * /assets — offline pack asset bundles (fonts.tar, sprites.tar)
 *
 * CalExp5's tile-download-manager fetches `/api/maps/assets/fonts.tar` and
 * `/api/maps/assets/sprites.tar` for the OPFS offline packs — this route did
 * not exist (found in the 2026-07-02 parity audit: the client contract was
 * written against it but the server never grew the endpoint). Serves whole
 * .tar files from ASSETS_DIR. Not cached: refresh-maps.sh replaces them in
 * place each month (Devin, PR #11).
 */
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';

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

      // One handle for stat AND body: the monthly swap renames a new file into
      // place, and a stat-then-open could pair the old length with the new bytes.
      // A rollback briefly removes the file between the check above and here.
      let fh;
      try {
        fh = await open(filePath, 'r');
      } catch (err) {
        if (err.code === 'ENOENT') return reply.code(404).send({ error: 'Asset bundle not found' });
        throw err;
      }
      const { size, mtimeMs } = await fh.stat();
      const etag = `"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
      reply
        .header('Content-Type', 'application/x-tar')
        .header('ETag', etag)
        // no-cache + ETag: a monthly release replaces these files under the same
        // URL, so caches revalidate (304 when unchanged) instead of serving
        // last month's tar for a new version.
        .header('Cache-Control', 'public, no-cache');

      // Weak comparison (RFC 9110 13.1.2): proxies may send W/"…" or a list.
      const inm = String(request.headers['if-none-match'] ?? '');
      if (inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag || t.trim() === '*')) {
        await fh.close();
        return reply.code(304).send();
      }
      reply.header('Content-Length', size);
      if (request.method === 'HEAD') {
        await fh.close();
        return reply.send();
      }
      return reply.send(fh.createReadStream());
    },
  });
}
