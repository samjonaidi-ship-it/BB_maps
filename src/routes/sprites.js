/**
 * /sprites — Map icon sprites serving
 *
 * Serves sprite sheets (PNG + JSON manifest) for map icons.
 * MapLibre requests: /sprites/{name}.png, /sprites/{name}.json,
 *                    /sprites/{name}@2x.png, /sprites/{name}@2x.json
 */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const SPRITES_DIR = process.env.SPRITES_DIR || resolve('data/sprites');

export async function spritesRoute(fastify) {
  // GET /sprites/:name — handles .png, .json, @2x variants
  fastify.get('/:name', async (request, reply) => {
    const { name } = request.params;

    // Security: prevent path traversal
    if (name.includes('..') || name.includes('/')) {
      return reply.code(400).send({ error: 'Invalid sprite name' });
    }

    const filePath = join(SPRITES_DIR, name);

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: `Sprite not found: ${name}` });
    }

    const buffer = await readFile(filePath);
    const contentType = name.endsWith('.json')
      ? 'application/json'
      : name.endsWith('.png')
        ? 'image/png'
        : 'application/octet-stream';

    reply
      .header('Content-Type', contentType)
      .header('Cache-Control', 'public, max-age=604800, immutable');

    return reply.send(buffer);
  });
}
