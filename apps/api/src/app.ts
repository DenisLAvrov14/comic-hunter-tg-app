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
import { calendarRoutes, icsRoutes } from './routes/calendar';
import { eventRoutes } from './routes/events';
import { internalRoutes } from './routes/internal';
import { referenceRoutes } from './routes/reference';
import { lineupRoutes } from './routes/lineup';
import { refreshEventPosts, type ChatPoster } from '@standup/notify';
import { postRoutes } from './routes/posts';
import type { FileStorage } from './storage';

export interface AppDeps {
  config: Config;
  db: Db;
  storage: FileStorage;
  /** Посты анонсов в группах и каналах. */
  poster: ChatPoster;
}

export async function buildApp({ config, db, storage, poster }: AppDeps) {
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

  const links = { botUsername: config.botUsername, miniAppShortName: config.miniAppShortName };
  /** Событие или состав изменились — обновить анонсы в чатах (SPEC §7.4). */
  const onEventChanged = async (eventId: string) => {
    try {
      await refreshEventPosts(db, poster, links, eventId);
    } catch (err) {
      app.log.warn({ err, eventId }, 'event posts refresh failed');
    }
  };

  app.get('/health', async () => ({ ok: true }));
  await app.register(icsRoutes, { db });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { config, db, storage });
      await api.register(meRoutes, { db, storage });
      await api.register(referenceRoutes, { db });
      await api.register(eventRoutes, { db, storage, onEventChanged });
      await api.register(lineupRoutes, { db, storage });
      await api.register(postRoutes, { db, poster, links });
      await api.register(calendarRoutes, { db, publicBaseUrl: config.publicBaseUrl });
      if (config.internalToken) {
        await api.register(internalRoutes, { db, token: config.internalToken });
      }
    },
    { prefix: '/api/v1' },
  );

  return app;
}
