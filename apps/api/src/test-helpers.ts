// Общие помощники интеграционных тестов API.
import { createDb, runMigrations, syncCities, type Db } from '@standup/db';
import { buildApp } from './app';
import { signInitData } from './auth/initData';
import type { Config } from './config';
import { MemorySender } from './messaging';
import { MemoryStorage } from './storage';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_BOT_TOKEN = '123456:TEST-token';

export const testConfig: Config = {
  env: 'test',
  port: 0,
  host: '127.0.0.1',
  databaseUrl: TEST_DATABASE_URL ?? '',
  botUsername: '',
  miniAppShortName: '',
  botToken: TEST_BOT_TOKEN,
  jwtSecret: 'x'.repeat(32),
  devAuth: false,
  logLevel: 'silent',
  initDataMaxAgeSeconds: 86400,
  s3: {
    endpoint: '',
    region: '',
    bucket: '',
    accessKey: '',
    secretKey: '',
    publicUrl: '/media',
    createBucket: false,
  },
};

export function signedInitData(tgUser: object, authDate = new Date()) {
  const params = new URLSearchParams({
    user: JSON.stringify(tgUser),
    auth_date: String(Math.floor(authDate.getTime() / 1000)),
  });
  params.set('hash', signInitData(params, TEST_BOT_TOKEN));
  return params.toString();
}

type App = Awaited<ReturnType<typeof buildApp>>;
type Method = 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE';

export interface TestClient {
  userId: string;
  telegramId: number;
  call: (
    method: Method,
    path: string,
    payload?: object,
  ) => Promise<Awaited<ReturnType<App['inject']>>>;
}

export async function setupTestApp(): Promise<{
  app: App;
  db: Db;
  sender: MemorySender;
  close: () => Promise<void>;
}> {
  const { db, close } = createDb(TEST_DATABASE_URL ?? 'postgres://unused');
  await runMigrations(db);
  await syncCities(db);
  const sender = new MemorySender();
  const app = await buildApp({ config: testConfig, db, storage: new MemoryStorage(), sender });
  return {
    app,
    db,
    sender,
    close: async () => {
      await app.close();
      await close();
    },
  };
}

/** Регистрирует пользователя через /auth/telegram и возвращает клиент с его JWT. */
export async function login(app: App, telegramId: number, firstName = 'Тест'): Promise<TestClient> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/telegram',
    payload: { initData: signedInitData({ id: telegramId, first_name: firstName }) },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  const { token, user } = res.json() as { token: string; user: { id: string } };
  return {
    userId: user.id,
    telegramId,
    call: (method, path, payload) =>
      app.inject({
        method,
        url: `/api/v1${path}`,
        headers: { authorization: `Bearer ${token}` },
        ...(payload ? { payload } : {}),
      }),
  };
}

/** Уникальный диапазон telegram_id на тестовый файл, чтобы файлы не мешали друг другу. */
export function telegramIdBase() {
  return 920_000_000 + Math.floor(Math.random() * 50_000_000);
}
