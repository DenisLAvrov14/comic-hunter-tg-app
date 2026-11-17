// Общие помощники интеграционных тестов API.
import { createDb, eq, runMigrations, schema, syncCities, type Db } from '@standup/db';
import { buildApp } from './app';
import { signInitData } from './auth/initData';
import type { Config } from './config';
import { MemoryPoster, MemorySender, runDueOnce } from '@standup/notify';
import { MemoryStorage } from './storage';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const TEST_BOT_TOKEN = '123456:TEST-token';
export const TEST_ADMIN_TELEGRAM_ID = 7_700_000_001;

export const testConfig: Config = {
  env: 'test',
  port: 0,
  host: '127.0.0.1',
  databaseUrl: TEST_DATABASE_URL ?? '',
  botUsername: 'standup_bot',
  miniAppShortName: 'app',
  publicBaseUrl: 'https://example.test',
  internalToken: 'test-internal-token',
  botToken: TEST_BOT_TOKEN,
  jwtSecret: 'x'.repeat(32),
  devAuth: false,
  logLevel: 'silent',
  initDataMaxAgeSeconds: 86400,
  // Первый админ для тестов админки: входит с этим Telegram ID.
  adminTelegramIds: [TEST_ADMIN_TELEGRAM_ID],
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
  /** Загрузить файл multipart-запросом (фото, лого). */
  upload: (
    method: Method,
    path: string,
    file: Buffer,
  ) => Promise<Awaited<ReturnType<App['inject']>>>;
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
  poster: MemoryPoster;
  /** Отправить созревшие уведомления на момент `now` (подмена времени в тестах). */
  deliver: (now?: Date) => Promise<Record<string, number>>;
  close: () => Promise<void>;
}> {
  const { db, close } = createDb(TEST_DATABASE_URL ?? 'postgres://unused');
  await runMigrations(db);
  await syncCities(db);
  const sender = new MemorySender();
  const poster = new MemoryPoster();
  const app = await buildApp({ config: testConfig, db, storage: new MemoryStorage(), poster });
  return {
    app,
    db,
    sender,
    poster,
    deliver: (now = new Date()) =>
      runDueOnce(db, {
        sender,
        links: { botUsername: 'bot', miniAppShortName: 'app' },
        now: () => now,
      }),
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
    upload: (method, path, file) => {
      const boundary = `----test${Math.random().toString(16).slice(2)}`;
      const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.png"\r\n` +
          'Content-Type: application/octet-stream\r\n\r\n',
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      return app.inject({
        method,
        url: `/api/v1${path}`,
        payload: Buffer.concat([head, file, tail]),
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });
    },
    call: (method, path, payload) =>
      app.inject({
        method,
        url: `/api/v1${path}`,
        headers: { authorization: `Bearer ${token}` },
        ...(payload ? { payload } : {}),
      }),
  };
}

/** Площадка проверена админом — видна всем организаторам (для тестов не про админку). */
export async function approveVenue(db: Db, venueId: string) {
  await db.update(schema.venues).set({ status: 'approved' }).where(eq(schema.venues.id, venueId));
}

/** Уникальный диапазон telegram_id на тестовый файл, чтобы файлы не мешали друг другу. */
export function telegramIdBase() {
  return 920_000_000 + Math.floor(Math.random() * 50_000_000);
}
