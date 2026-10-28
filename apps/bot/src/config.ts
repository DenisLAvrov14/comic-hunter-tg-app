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
  LOG_LEVEL: z.string().default('info'),
});

export type BotConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Некорректная конфигурация бота:\n${issues.join('\n')}`);
  }
  return parsed.data;
}
