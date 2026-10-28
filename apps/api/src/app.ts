import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { Db } from '@standup/db';
import type { Config } from './config';
import { registerErrorHandler } from './errors';
import { authPlugin } from './plugins/auth';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { eventRoutes } from './routes/events';
import { referenceRoutes } from './routes/reference';
import type { MessageSender } from './messaging';
import { lineupRoutes } from './routes/lineup';
import type { FileStorage } from './storage';

export interface AppDeps {
  config: Config;
  db: Db;
  storage: FileStorage;
  sender: MessageSender;
}

export async function buildApp({ config, db, storage, sender }: AppDeps) {
  const app = Fastify({
    logger:
      config.env === 'test'
        ? false
        : {
            level: config.logLevel,
            // Токены и initData не должны попадать в логи.
            redact: ['req.headers.authorization', 'req.body.initData', 'req.query.token'],
          },
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    trustProxy: true,
  });

  registerErrorHandler(app);
  await app.register(rateLimit, { global: false });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: '7d' } });
  await app.register(multipart);
  await app.register(authPlugin);

  app.get('/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      await api.register(authRoutes, { config, db, storage });
      await api.register(meRoutes, { db, storage });
      await api.register(referenceRoutes, { db });
      await api.register(eventRoutes, { db, storage });
      await api.register(lineupRoutes, { config, db, storage, sender });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
