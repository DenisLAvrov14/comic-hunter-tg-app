import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// Проверка подписи Telegram Mini App initData:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

const TelegramUser = z.object({
  id: z.number().int(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
});
export type TelegramUser = z.infer<typeof TelegramUser>;

export interface VerifiedInitData {
  user: TelegramUser;
  authDate: Date;
  startParam: string | null;
}

export type InitDataFailure = 'malformed' | 'bad_signature' | 'expired' | 'no_user';

export type VerifyResult =
  { ok: true; data: VerifiedInitData } | { ok: false; reason: InitDataFailure };

export function initDataSecretKey(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

/** data-check-string: все поля кроме hash, отсортированные по ключу, `key=value` через `\n`. */
export function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
}

export function signInitData(params: URLSearchParams, botToken: string): string {
  return createHmac('sha256', initDataSecretKey(botToken))
    .update(dataCheckString(params))
    .digest('hex');
}

export function verifyInitData(
  raw: string,
  botToken: string,
  opts: { maxAgeSeconds: number; now?: Date },
): VerifyResult {
  const params = new URLSearchParams(raw);
  const hash = params.get('hash');
  const authDateRaw = params.get('auth_date');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash) || !authDateRaw || !/^\d+$/.test(authDateRaw)) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = Buffer.from(signInitData(params, botToken), 'hex');
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) {
    return { ok: false, reason: 'bad_signature' };
  }

  const authDate = new Date(Number(authDateRaw) * 1000);
  const now = opts.now ?? new Date();
  if (now.getTime() - authDate.getTime() > opts.maxAgeSeconds * 1000) {
    return { ok: false, reason: 'expired' };
  }

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'no_user' };
  let user: TelegramUser;
  try {
    user = TelegramUser.parse(JSON.parse(userRaw));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  return { ok: true, data: { user, authDate, startParam: params.get('start_param') } };
}
