import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { findUserByTelegramId, type Db } from '@standup/db';
import { ApiError } from '../errors';

const AsUserRequest = z.object({
  telegramId: z.number().int().positive(),
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']),
  /** Путь внутри /api/v1, например `/participations/<id>/actions`. */
  path: z.string().regex(/^\/(?!internal)[\w\-/]+$/),
  payload: z.unknown().optional(),
});

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Бот выполняет действия пользователя (кнопки в сообщениях) через обычные эндпоинты API:
 * та же валидация и те же проверки прав через can(). Доступно только по общему секрету;
 * nginx этот путь наружу не пропускает.
 */
export const internalRoutes: FastifyPluginAsync<{ db: Db; token: string }> = async (
  app,
  { db, token },
) => {
  app.post('/internal/as-user', async (req, reply) => {
    const header = req.headers['x-internal-token'];
    if (typeof header !== 'string' || !sameSecret(header, token))
      throw new ApiError('UNAUTHORIZED');
    const body = AsUserRequest.parse(req.body);
    const user = await findUserByTelegramId(db, body.telegramId);
    if (!user) throw new ApiError('NOT_FOUND');
    const res = await app.inject({
      method: body.method,
      url: `/api/v1${body.path}`,
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id })}` },
      ...(body.payload === undefined ? {} : { payload: body.payload as object }),
    });
    return reply.status(res.statusCode).header('content-type', 'application/json').send(res.body);
  });
};
