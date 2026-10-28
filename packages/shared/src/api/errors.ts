import { z } from 'zod';

export const errorCodes = [
  'VALIDATION',
  // TODO(spec): в разделе 9 нет кода для 401 — добавлен UNAUTHORIZED (и RATE_LIMITED, INTERNAL).
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT_SCHEDULE',
  'LINEUP_FULL',
  'VERSION_MISMATCH',
  'INVALID_TRANSITION',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export const ErrorCode = z.enum(errorCodes);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiErrorBody = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;
