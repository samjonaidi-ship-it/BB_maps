/**
 * /styles — MapLibre style JSON serving
 *
 * Serves pre-built style definitions for BB Maps themes (dark, light, satellite).
 * Styles reference tile/font/sprite URLs relative to this server.
 */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const STYLES_DIR = process.env.STYLES_DIR || resolve('data/styles');

export async function stylesRoute(fastify) {
  // GET /styles/:name.json — serve a named style
  fastify.get('/:name', async (request, reply) => {
    const { name } = request.params;
    const styleName = name.replace(/\.json$/, '');

    // Security: prevent path traversal
    if (styleName.includes('..') || styleName.includes('/')) {
      return reply.code(400).send({ error: 'Invalid style name' });
    }

    const filePath = join(STYLES_DIR, `${styleName}.json`);

    if (!existsSync(filePath)) {
      return reply.code(404).send({ error: `Style "${styleName}" not found` });
    }

    try {
      const content = await readFile(filePath, 'utf-8');
      const style = JSON.parse(content);

      // Inject this server's base URL into the style for relative resource resolution
      const baseUrl = getBaseUrl(request);
      const resolved = resolveStyleUrls(style, baseUrl);

      reply
        .header('Content-Type', 'application/json')
        .header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')
        .send(resolved);
    } catch (err) {
      fastify.log.error({ err, styleName }, 'Failed to serve style');
      return reply.code(500).send({ error: 'Failed to load style' });
    }
  });

  // GET /styles — list available styles
  fastify.get('/', async (request, reply) => {
    const { readdirSync } = await import('node:fs');

    if (!existsSync(STYLES_DIR)) {
      return reply.send({ styles: [] });
    }

    const files = readdirSync(STYLES_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));

    reply.send({ styles: files });
  });
}

/**
 * Resolve relative URLs in style JSON to absolute URLs pointing to this server.
 * Replaces {baseUrl} placeholders in sources, glyphs, and sprite fields.
 */
function resolveStyleUrls(style, baseUrl) {
  const resolved = { ...style };

  // Resolve glyphs URL
  if (resolved.glyphs) {
    resolved.glyphs = resolved.glyphs.replace('{baseUrl}', baseUrl);
  }

  // Resolve sprite URL
  if (resolved.sprite) {
    if (typeof resolved.sprite === 'string') {
      resolved.sprite = resolved.sprite.replace('{baseUrl}', baseUrl);
    } else if (Array.isArray(resolved.sprite)) {
      resolved.sprite = resolved.sprite.map(s =>
        typeof s === 'string'
          ? s.replace('{baseUrl}', baseUrl)
          : { ...s, url: s.url?.replace('{baseUrl}', baseUrl) }
      );
    }
  }

  // Resolve source tile URLs
  if (resolved.sources) {
    for (const [key, source] of Object.entries(resolved.sources)) {
      if (source.url) {
        resolved.sources[key] = {
          ...source,
          url: source.url.replace('{baseUrl}', baseUrl),
        };
      }
      if (source.tiles) {
        resolved.sources[key] = {
          ...(resolved.sources[key] || source),
          tiles: source.tiles.map(t => t.replace('{baseUrl}', baseUrl)),
        };
      }
    }
  }

  return resolved;
}

function getBaseUrl(request) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL;
  const proto = request.headers['x-forwarded-proto'] || 'http';
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  return `${proto}://${host}`;
}
