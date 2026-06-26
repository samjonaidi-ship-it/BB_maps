import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';

import { tilesRoute } from './routes/tiles.js';
import { geocodeRoute } from './routes/geocode.js';
import { satelliteRoute } from './routes/satellite.js';
import { stylesRoute } from './routes/styles.js';
import { fontsRoute } from './routes/fonts.js';
import { spritesRoute } from './routes/sprites.js';
import { adminRoute } from './routes/admin.js';
import { healthRoute } from './routes/health.js';

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty' }
      : undefined,
  },
  trustProxy: true,
});

// --- Plugins ---
await app.register(cors, {
  origin: process.env.CORS_ORIGIN?.split(',') || ['*'],
  methods: ['GET', 'HEAD', 'OPTIONS'],
});

await app.register(rateLimit, {
  max: parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  timeWindow: '1 minute',
});

// --- Routes ---
await app.register(tilesRoute, { prefix: '/tiles' });
await app.register(geocodeRoute, { prefix: '/geocode' });
await app.register(satelliteRoute, { prefix: '/satellite' });
await app.register(stylesRoute, { prefix: '/styles' });
await app.register(fontsRoute, { prefix: '/fonts' });
await app.register(spritesRoute, { prefix: '/sprites' });
await app.register(adminRoute, { prefix: '/admin' });
await app.register(healthRoute);

// --- Start ---
try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`BB_Maps listening on ${HOST}:${PORT}`);
} catch (err) {
  app.log.fatal(err);
  process.exit(1);
}

export { app };
