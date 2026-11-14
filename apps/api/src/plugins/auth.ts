import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { findUserById, type Db } from '@standup/db';
import { ApiError } from '../errors';

export interface JwtPayload {
  sub: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest) => Promise<void>;
  }
}

const plugin: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new ApiError('UNAUTHORIZED');
    }
    // JWT живёт 7 дней: после удаления аккаунта выданные токены не должны работать.
    const user = await findUserById(db, req.user.sub);
    if (!user || user.deletedAt) throw new ApiError('UNAUTHORIZED');
  });
};

// fp — без инкапсуляции, чтобы декоратор был виден во всех роутах.
export const authPlugin = fp(plugin, { name: 'auth' });
