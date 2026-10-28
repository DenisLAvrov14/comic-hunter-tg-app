import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  BOT_TOKEN: z.string().default(''),
  BOT_USERNAME: z
    .string()
    .default('')
    .transform((v) => v.replace(/^@/, '')),
  MINIAPP_SHORT_NAME: z.string().default(''),
  LOG_LEVEL: z.string().default('info'),
  /** Период планировщика (SPEC: раз в минуту). */
  SCHEDULER_TICK_MS: z.coerce.number().int().min(1000).default(60_000),
});

export type WorkerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Некорректная конфигурация worker:\n${issues.join('\n')}`);
  }
  return parsed.data;
}
