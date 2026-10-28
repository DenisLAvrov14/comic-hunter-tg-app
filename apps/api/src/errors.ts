import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { ApiErrorBody, ErrorCode } from '@standup/shared';
import { ru } from '@standup/shared';

const statusByCode: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT_SCHEDULE: 409,
  LINEUP_FULL: 409,
  VERSION_MISMATCH: 409,
  INVALID_TRANSITION: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = ru.errors[code],
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function body(code: ErrorCode, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | ApiError | ZodError, req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(statusByCode[err.code]).send(body(err.code, err.message, err.details));
    }
    if (err instanceof ZodError) {
      return reply.status(400).send(body('VALIDATION', ru.errors.VALIDATION, err.issues));
    }
    if (err.statusCode === 429) {
      return reply.status(429).send(body('RATE_LIMITED', ru.errors.RATE_LIMITED));
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.status(err.statusCode).send(body('VALIDATION', err.message));
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send(body('INTERNAL', ru.errors.INTERNAL));
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send(body('NOT_FOUND', ru.errors.NOT_FOUND)),
  );
}
