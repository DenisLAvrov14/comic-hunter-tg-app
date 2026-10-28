import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
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

const plugin: FastifyPluginAsync = async (app) => {
  app.decorate('authenticate', async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new ApiError('UNAUTHORIZED');
    }
  });
};

// fp — без инкапсуляции, чтобы декоратор был виден во всех роутах.
export const authPlugin = fp(plugin, { name: 'auth' });
