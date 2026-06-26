/**
 * /tiles — PMTiles range-request proxy
 *
 * Serves vector tiles from local PMTiles files via HTTP range requests.
 * MapLibre GL JS sends range requests; we read the corresponding byte range
 * from the .pmtiles file and return it with proper caching headers.
 */
import { open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const TILES_DIR = process.env.TILES_DIR || resolve('data/tiles');

export async function tilesRoute(fastify) {
  // GET /tiles/:filename — serve PMTiles with range request support
  fastify.get('/:filename', async (request, reply) => {
    const { filename } = request.params;

    // Security: prevent path traversal
    if (filename.includes('..') || filename.includes('/')) {
      return reply.code(400).send({ error: 'Invalid filename' });
    }

    const filePath = join(TILES_DIR, filename);

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: 'Tile file not found' });
    }

    const rangeHeader = request.headers.range;
    const stat = await import('node:fs/promises').then(fs => fs.stat(filePath));
    const fileSize = stat.size;

    // If no Range header, return metadata about the file
    if (!rangeHeader) {
      reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', fileSize)
        .header('Accept-Ranges', 'bytes')
        .header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
        .header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

      const { createReadStream } = await import('node:fs');
      return reply.send(createReadStream(filePath));
    }

    // Parse Range header: bytes=start-end
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (!match) {
      return reply.code(416).send({ error: 'Invalid range' });
    }

    const start = parseInt(match[1], 10);
    const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      reply.header('Content-Range', `bytes */${fileSize}`);
      return reply.code(416).send({ error: 'Range not satisfiable' });
    }

    const contentLength = end - start + 1;
    const fd = await open(filePath, 'r');
    const buffer = Buffer.alloc(contentLength);
    await fd.read(buffer, 0, contentLength, start);
    await fd.close();

    reply
      .code(206)
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Range', `bytes ${start}-${end}/${fileSize}`)
      .header('Content-Length', contentLength)
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
      .header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

    return reply.send(buffer);
  });

  // HEAD /tiles/:filename — for MapLibre to discover file size
  fastify.head('/:filename', async (request, reply) => {
    const { filename } = request.params;

    if (filename.includes('..') || filename.includes('/')) {
      return reply.code(400).send({ error: 'Invalid filename' });
    }

    const filePath = join(TILES_DIR, filename);

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: 'Tile file not found' });
    }

    const stat = await import('node:fs/promises').then(fs => fs.stat(filePath));

    reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Length', stat.size)
      .header('Accept-Ranges', 'bytes')
      .header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
      .header('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

    return reply.send();
  });
}
