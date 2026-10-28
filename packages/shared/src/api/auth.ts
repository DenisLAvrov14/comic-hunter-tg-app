import { z } from 'zod';
import { Me } from './me';

export const TelegramAuthRequest = z.object({
  initData: z.string().min(1).max(4096),
});
export type TelegramAuthRequest = z.infer<typeof TelegramAuthRequest>;

export const DevAuthRequest = z.object({
  telegramId: z.number().int().positive(),
  firstName: z.string().min(1).max(64).default('Dev'),
  username: z.string().max(32).optional(),
});
export type DevAuthRequest = z.input<typeof DevAuthRequest>;

export const AuthResponse = z.object({
  token: z.string(),
  user: Me,
  /** start_param из initData — для роутинга Mini App (e_, j_, i_). */
  startParam: z.string().nullable(),
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const AuthConfigResponse = z.object({
  devAuth: z.boolean(),
  /** Для прямых ссылок t.me/<bot>/<app>?startapp=...; пустые, если не настроены. */
  botUsername: z.string(),
  miniAppShortName: z.string(),
});
export type AuthConfigResponse = z.infer<typeof AuthConfigResponse>;
