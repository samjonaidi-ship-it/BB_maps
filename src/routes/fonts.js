/**
 * /fonts — PBF glyph range serving for MapLibre text rendering
 *
 * Serves pre-generated Protocol Buffer font glyphs.
 * MapLibre requests: /fonts/{fontstack}/{range}.pbf
 * Example: /fonts/Noto Sans Regular/0-255.pbf
 */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const FONTS_DIR = process.env.FONTS_DIR || resolve('data/fonts');

export async function fontsRoute(fastify) {
  // GET /fonts/:fontstack/:range.pbf
  fastify.get('/:fontstack/:range', async (request, reply) => {
    const { fontstack, range } = request.params;

    // Params arrive already URL-decoded by the router. The old extra
    // decodeURIComponent here (audit fix) both 500'd on literal '%' in a
    // fontstack and re-opened traversal via double-encoding (%252e%252e →
    // '..' AFTER the check below had already passed).
    const normalizedStack = fontstack.replace(/,\s*/g, ',');

    // For combined font stacks (e.g., "Noto Sans Regular,Arial Unicode MS Regular"),
    // use the first font in the stack
    const primaryFont = normalizedStack.split(',')[0].trim();

    // Security: validate the FINAL path components (post-normalization)
    if (primaryFont.includes('..') || primaryFont.includes('/') || primaryFont.includes('\\')
      || range.includes('..') || range.includes('/') || range.includes('\\')) {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    const rangeName = range.replace(/\.pbf$/, '');
    const filePath = join(FONTS_DIR, primaryFont, `${rangeName}.pbf`);

    if (!existsSync(filePath)) {
      // Try fallback to "Noto Sans Regular" (our universal fallback)
      const fallbackPath = join(FONTS_DIR, 'Noto Sans Regular', `${rangeName}.pbf`);
      if (existsSync(fallbackPath)) {
        const buffer = await readFile(fallbackPath);
        reply
          .header('Content-Type', 'application/x-protobuf')
          .header('Cache-Control', 'public, max-age=604800, immutable')
          .header('X-Font-Fallback', 'true');
        return reply.send(buffer);
      }
      return reply.code(404).send({ error: `Font glyph not found: ${primaryFont}/${rangeName}` });
    }

    const buffer = await readFile(filePath);

    reply
      .header('Content-Type', 'application/x-protobuf')
      .header('Cache-Control', 'public, max-age=604800, immutable');

    return reply.send(buffer);
  });
}
