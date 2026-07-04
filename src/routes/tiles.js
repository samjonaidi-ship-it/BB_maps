/**
 * /tiles — PMTiles range-request proxy
 *
 * Serves vector tiles from local PMTiles files via HTTP range requests.
 * MapLibre GL JS sends range requests; we read the corresponding byte range
 * from the .pmtiles file and return it with proper caching headers.
 */
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const TILES_DIR = process.env.TILES_DIR || resolve('data/tiles');

export async function tilesRoute(fastify) {
  // GET + HEAD /tiles/:filename — serve PMTiles with range request support.
  // Single route handling both methods avoids FST_ERR_DUPLICATED_ROUTE:
  // Fastify auto-registers a HEAD for every GET, so a separate fastify.head()
  // on the same path collides. The HEAD branch (MapLibre file-size discovery)
  // returns headers only — no body stream.
  fastify.route({
  method: ['GET', 'HEAD'],
  url: '/:filename',
  handler: async (request, reply) => {
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

    // Validator (audit 2026-07-03 E): size + mtime uniquely identify a tile
    // build, so a re-seed (new file) changes the ETag. This lets clients 304 an
    // unchanged full GET AND — via If-Range — detect that a partially-downloaded
    // pack's underlying file changed mid-transfer, so resumed ranges don't stitch
    // stale + fresh bytes into a corrupt pmtiles.
    const etag = `"${fileSize}-${Math.floor(stat.mtimeMs)}"`;
    const lastModified = new Date(stat.mtimeMs).toUTCString();
    const CACHE = 'public, max-age=86400, stale-while-revalidate=604800';
    const EXPOSE = 'Content-Range, Content-Length, Accept-Ranges, ETag';

    // HEAD — return file-size headers only (MapLibre size discovery), no body.
    if (request.method === 'HEAD') {
      reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', fileSize)
        .header('Accept-Ranges', 'bytes')
        .header('ETag', etag)
        .header('Last-Modified', lastModified)
        .header('Cache-Control', CACHE)
        .header('Access-Control-Expose-Headers', EXPOSE);
      return reply.send();
    }

    // Unchanged full entity → 304 (client already has this exact build).
    if (!rangeHeader && request.headers['if-none-match'] === etag) {
      return reply
        .code(304)
        .header('ETag', etag)
        .header('Cache-Control', CACHE)
        .send();
    }

    // If-Range mismatch (audit E): the client holds a range from an OLDER file
    // build. Serving a 206 would splice stale + fresh bytes. Per RFC 7233 a
    // failed If-Range must return the WHOLE current entity (200), so drop the
    // range and fall through to a full send.
    const ifRange = request.headers['if-range'];
    const rangeInvalidatedByBuild = rangeHeader && ifRange && ifRange !== etag;

    // If no Range header (or If-Range invalidated it), return the full file.
    if (!rangeHeader || rangeInvalidatedByBuild) {
      reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', fileSize)
        .header('Accept-Ranges', 'bytes')
        .header('ETag', etag)
        .header('Last-Modified', lastModified)
        .header('Cache-Control', CACHE)
        .header('Access-Control-Expose-Headers', EXPOSE);

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

    // Cap a single range to 16MB (audit 2026-07-03 F10): an open-ended
    // `bytes=0-` yields the whole ~60MB file, and a burst of parallel such
    // ranges could allocate >1GB of heap. pmtiles reads are small; clients
    // that want more re-request. Stream (createReadStream) instead of a full
    // Buffer.alloc so we never materialize the whole slice, and so a short OS
    // read can't serve a zero-padded tail as a correct-looking 206.
    const MAX_RANGE = 16 * 1024 * 1024;
    const cappedEnd = Math.min(end, start + MAX_RANGE - 1);
    const cappedLen = cappedEnd - start + 1;
    const { createReadStream } = await import('node:fs');
    reply
      .code(206)
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Range', `bytes ${start}-${cappedEnd}/${fileSize}`)
      .header('Content-Length', cappedLen)
      .header('Accept-Ranges', 'bytes')
      .header('ETag', etag)
      .header('Last-Modified', lastModified)
      .header('Cache-Control', CACHE)
      .header('Access-Control-Expose-Headers', EXPOSE);
    return reply.send(createReadStream(filePath, { start, end: cappedEnd }));
  },
  });
}
