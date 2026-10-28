import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createDb, eq, runMigrations, schema, syncCities } from '@standup/db';
import { buildApp } from './app';
import { signInitData } from './auth/initData';
import type { Config } from './config';
import { MemoryPoster } from '@standup/notify';
import { MemoryStorage } from './storage';

// Интеграционный тест против реального Postgres: TEST_DATABASE_URL=postgres://... pnpm test
const url = process.env.TEST_DATABASE_URL;

const BOT_TOKEN = '123456:TEST-token';
const config: Config = {
  env: 'test',
  port: 0,
  host: '127.0.0.1',
  databaseUrl: url ?? '',
  botUsername: '',
  miniAppShortName: '',
  publicBaseUrl: 'https://example.test',
  internalToken: '',
  botToken: BOT_TOKEN,
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

function initData(tgUser: object, authDate = new Date()) {
  const params = new URLSearchParams({
    user: JSON.stringify(tgUser),
    auth_date: String(Math.floor(authDate.getTime() / 1000)),
  });
  params.set('hash', signInitData(params, BOT_TOKEN));
  return params.toString();
}

describe.skipIf(!url)('API auth (Postgres)', () => {
  const { db, close } = createDb(url ?? 'postgres://unused');
  let app: Awaited<ReturnType<typeof buildApp>>;
  const telegramId = 900_000_000 + Math.floor(Math.random() * 1_000_000);

  beforeAll(async () => {
    await runMigrations(db);
    await db.delete(schema.users).where(eq(schema.users.telegramId, telegramId));
    app = await buildApp({ config, db, storage: new MemoryStorage(), poster: new MemoryPoster() });
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.telegramId, telegramId));
    await app?.close();
    await close();
  });

  it('POST /auth/telegram создаёт пользователя и выдаёт JWT, /me его возвращает', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: initData({ id: telegramId, first_name: 'Тест', username: 't' }) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toMatchObject({ telegramId, firstName: 'Тест', roles: [] });

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.telegramId, telegramId));
    expect(rows).toHaveLength(1);

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().id).toBe(rows[0]!.id);
  });

  it('повторный вход обновляет данные, не создавая дубликат', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: initData({ id: telegramId, first_name: 'Новое имя' }) },
    });
    expect(res.statusCode).toBe(200);
    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.telegramId, telegramId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.firstName).toBe('Новое имя');
  });

  it('отклоняет подделанный initData с кодом UNAUTHORIZED', async () => {
    const forged = initData({ id: telegramId, first_name: 'X' }).replace('X', 'Y');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: forged },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('отклоняет пустое тело с кодом VALIDATION', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/telegram', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('/me без токена — 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode).toBe(401);
  });

  it('dev-вход недоступен при DEV_AUTH=false', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/dev',
      payload: { telegramId },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe.skipIf(!url)('API профили и справочники (Postgres)', () => {
  const { db, close } = createDb(url ?? 'postgres://unused');
  const storage = new MemoryStorage();
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token = '';
  let moscowId = 0;
  const telegramId = 910_000_000 + Math.floor(Math.random() * 1_000_000);

  const call = (
    method: 'GET' | 'PUT' | 'PATCH' | 'POST' | 'DELETE',
    path: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { authorization: `Bearer ${token}` },
      ...(payload ? { payload } : {}),
    });

  function multipart(file: Buffer, filename = 'photo.png') {
    const boundary = `----test${Math.random().toString(16).slice(2)}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
      payload: Buffer.concat([head, file, tail]),
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
    };
  }

  beforeAll(async () => {
    await runMigrations(db);
    await syncCities(db);
    await db.delete(schema.users).where(eq(schema.users.telegramId, telegramId));
    app = await buildApp({ config, db, storage, poster: new MemoryPoster() });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/telegram',
      payload: { initData: initData({ id: telegramId, first_name: 'Комик' }) },
    });
    token = res.json().token;
    const cities = (await call('GET', '/cities')).json() as Array<{ id: number; name: string }>;
    moscowId = cities.find((c) => c.name === 'Москва')!.id;
  });

  afterAll(async () => {
    await db.delete(schema.venues).where(eq(schema.venues.name, `Тест ${telegramId}`));
    await db.delete(schema.users).where(eq(schema.users.telegramId, telegramId));
    await app?.close();
    await close();
  });

  it('онбординг: роли → профили → onboarded', async () => {
    let me = (await call('GET', '/me')).json();
    expect(me.onboarded).toBe(false);

    me = (await call('PUT', '/me/roles', { roles: ['comedian', 'organizer'] })).json();
    expect(me.roles.sort()).toEqual(['comedian', 'organizer']);
    expect(me.onboarded).toBe(false);

    const res = await call('PUT', '/me/comedian-profile', {
      stageName: 'Тестовый Комик',
      cityId: moscowId,
      contact: '@test',
    });
    expect(res.statusCode).toBe(200);
    // Ещё нужен профиль организатора.
    expect(res.json().onboarded).toBe(false);

    me = (
      await call('PUT', '/me/organizer-profile', { displayName: 'Орг', cityId: moscowId })
    ).json();
    expect(me.onboarded).toBe(true);
    expect(me.timezone).toBe('Europe/Moscow');
    expect(me.comedianProfile).toMatchObject({ category: 'newbie', travelBufferMinutes: 30 });
  });

  it('профиль заполняется постепенно: необязательные поля не затираются', async () => {
    await call('PUT', '/me/comedian-profile', {
      stageName: 'Тестовый Комик',
      cityId: moscowId,
      contact: '@test',
      bio: 'Про метро',
      links: [{ type: 'youtube', url: 'https://youtube.com/watch?v=1' }],
    });
    const me = (
      await call('PUT', '/me/comedian-profile', {
        stageName: 'Новое имя',
        cityId: moscowId,
        contact: '@test',
      })
    ).json();
    expect(me.comedianProfile).toMatchObject({
      stageName: 'Новое имя',
      bio: 'Про метро',
      links: [{ type: 'youtube', url: 'https://youtube.com/watch?v=1' }],
    });
  });

  it('профиль без обязательных полей или с несуществующим городом — VALIDATION', async () => {
    expect((await call('PUT', '/me/comedian-profile', { stageName: 'X' })).statusCode).toBe(400);
    const res = await call('PUT', '/me/comedian-profile', {
      stageName: 'X',
      cityId: 999_999,
      contact: '@x',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('фото загружается, получает превью 400px и удаляется', async () => {
    const png = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#c33' },
    })
      .png()
      .toBuffer();
    const res = await app.inject({ method: 'POST', url: '/api/v1/me/photos', ...multipart(png) });
    expect(res.statusCode).toBe(201);
    const photo = res.json();
    expect(photo).toMatchObject({ width: 1200, height: 800 });

    const previewKey = photo.previewUrl.replace('/media/', '');
    const preview = await sharp(storage.files.get(previewKey)!.body).metadata();
    expect(preview).toMatchObject({ width: 400, format: 'jpeg' });

    const me = (await call('GET', '/me')).json();
    expect(me.comedianProfile.photos).toHaveLength(1);

    expect((await call('DELETE', `/me/photos/${photo.id}`)).statusCode).toBe(204);
    expect(storage.files.has(previewKey)).toBe(false);
  });

  it('не картинка — VALIDATION', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/me/photos',
      ...multipart(Buffer.from('hello'), 'x.txt'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('организатор создаёт площадку, она видна в списке города', async () => {
    const created = await call('POST', '/venues', {
      name: `Тест ${telegramId}`,
      address: 'ул. Тестовая, 1',
      cityId: moscowId,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().timezone).toBe('Europe/Moscow');
    const list = (await call('GET', `/venues?city=${moscowId}`)).json() as Array<{ id: string }>;
    expect(list.map((v) => v.id)).toContain(created.json().id);
  });

  it('без роли организатора площадку создать нельзя', async () => {
    await call('PUT', '/me/roles', { roles: ['comedian'] });
    const res = await call('POST', '/venues', {
      name: 'Нельзя',
      address: 'ул. Тестовая, 2',
      cityId: moscowId,
    });
    expect(res.statusCode).toBe(403);
  });
});
