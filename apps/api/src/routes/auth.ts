import type { FastifyPluginAsync } from 'fastify';
import { upsertTelegramUser, type Db } from '@standup/db';
import {
  DevAuthRequest,
  TelegramAuthRequest,
  type AuthConfigResponse,
  type AuthResponse,
} from '@standup/shared';
import { verifyInitData } from '../auth/initData';
import type { Config } from '../config';
import { ApiError } from '../errors';
import { loadMe } from '../services/me';
import type { FileStorage } from '../storage';

const authRateLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

export const authRoutes: FastifyPluginAsync<{
  config: Config;
  db: Db;
  storage: FileStorage;
}> = async (app, { config, db, storage }) => {
  app.get('/auth/config', async (): Promise<AuthConfigResponse> => ({
    devAuth: config.devAuth,
    botUsername: config.botUsername,
    miniAppShortName: config.miniAppShortName,
  }));

  app.post('/auth/telegram', { config: authRateLimit }, async (req): Promise<AuthResponse> => {
    const { initData } = TelegramAuthRequest.parse(req.body);
    const res = verifyInitData(initData, config.botToken, {
      maxAgeSeconds: config.initDataMaxAgeSeconds,
    });
    if (!res.ok) {
      req.log.info({ reason: res.reason }, 'initData rejected');
      throw new ApiError('UNAUTHORIZED', 'Неверные данные авторизации Telegram');
    }
    const user = await upsertTelegramUser(db, res.data.user);
    return {
      token: app.jwt.sign({ sub: user.id }),
      user: await loadMe(db, storage, user),
      startParam: res.data.startParam,
    };
  });

  if (config.devAuth) {
    app.post('/auth/dev', { config: authRateLimit }, async (req): Promise<AuthResponse> => {
      const body = DevAuthRequest.parse(req.body);
      const user = await upsertTelegramUser(db, {
        id: body.telegramId,
        first_name: body.firstName,
        username: body.username,
      });
      return {
        token: app.jwt.sign({ sub: user.id }),
        user: await loadMe(db, storage, user),
        startParam: null,
      };
    });
  }
};
