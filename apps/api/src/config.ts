import { z } from 'zod';
import type { S3Config } from './storage';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().default(''),
  BOT_USERNAME: z.string().default(''),
  MINIAPP_SHORT_NAME: z.string().default(''),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET должен быть не короче 32 символов'),
  DEV_AUTH: bool,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('standup'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_PUBLIC_URL: z.string().default('/media'),
  S3_CREATE_BUCKET: bool,
});

export type Config = {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  botToken: string;
  botUsername: string;
  miniAppShortName: string;
  jwtSecret: string;
  devAuth: boolean;
  logLevel: string;
  initDataMaxAgeSeconds: number;
  s3: S3Config & { createBucket: boolean };
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Некорректная конфигурация API:\n${issues.join('\n')}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && e.DEV_AUTH) {
    throw new Error('DEV_AUTH=true запрещён в production');
  }
  if (!e.DEV_AUTH && !e.BOT_TOKEN) {
    throw new Error('BOT_TOKEN обязателен (без него нельзя проверить initData)');
  }
  return {
    env: e.NODE_ENV,
    port: e.API_PORT,
    host: e.API_HOST,
    databaseUrl: e.DATABASE_URL,
    botToken: e.BOT_TOKEN,
    botUsername: e.BOT_USERNAME.replace(/^@/, ''),
    miniAppShortName: e.MINIAPP_SHORT_NAME,
    jwtSecret: e.JWT_SECRET,
    devAuth: e.DEV_AUTH,
    logLevel: e.LOG_LEVEL,
    initDataMaxAgeSeconds: 24 * 60 * 60,
    s3: {
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKey: e.S3_ACCESS_KEY,
      secretKey: e.S3_SECRET_KEY,
      publicUrl: e.S3_PUBLIC_URL,
      createBucket: e.S3_CREATE_BUCKET,
    },
  };
}
