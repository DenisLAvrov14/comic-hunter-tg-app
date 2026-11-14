import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().default(''),
  BOT_USERNAME: z
    .string()
    .default('')
    .transform((v) => v.replace(/^@/, '')),
  MINIAPP_SHORT_NAME: z.string().default(''),
  /** https-адрес, где отдаётся Mini App (для кнопок web_app в личке). */
  MINIAPP_URL: z.string().default(''),
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  BOT_WEBHOOK_PORT: z.coerce.number().int().default(3001),
  BOT_WEBHOOK_SECRET: z.string().default(''),
  /** Публичный https-адрес вебхука, например https://example.kz/bot/webhook. */
  BOT_WEBHOOK_URL: z.string().default(''),
  LOG_LEVEL: z.string().default('info'),
  /** API внутри сети: кнопки в сообщениях выполняются через его эндпоинты. */
  API_INTERNAL_URL: z.string().default('http://localhost:3000'),
  INTERNAL_TOKEN: z.string().default(''),
});

export type BotConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Некорректная конфигурация бота:\n${issues.join('\n')}`);
  }
  const c = parsed.data;
  if (c.BOT_TOKEN && c.BOT_MODE === 'webhook') {
    // Секрет сверяется с заголовком X-Telegram-Bot-Api-Secret-Token: допустимы A-Z a-z 0-9 _ -.
    if (!/^[\w-]{16,256}$/.test(c.BOT_WEBHOOK_SECRET)) {
      throw new Error('BOT_WEBHOOK_SECRET: 16–256 символов из A-Z, a-z, 0-9, _ и -');
    }
    if (!c.BOT_WEBHOOK_URL.startsWith('https://')) {
      throw new Error('BOT_WEBHOOK_URL должен быть https-адресом');
    }
  }
  return c;
}
