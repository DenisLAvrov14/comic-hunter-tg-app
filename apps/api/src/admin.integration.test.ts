import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, schema } from '@standup/db';
import type { AdminPerson, PendingVenue, Venue, VenueListItem } from '@standup/shared';
import {
  TEST_ADMIN_TELEGRAM_ID,
  TEST_DATABASE_URL,
  login,
  setupTestApp,
  telegramIdBase,
  type TestClient,
} from './test-helpers';

// Админка: проверка площадок и назначение админов.
describe.skipIf(!TEST_DATABASE_URL)('API админка (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  const base = telegramIdBase();
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  let moscow = 0;
  let admin: TestClient;
  let org: TestClient;
  let other: TestClient;

  const organizer = async (telegramId: number, name: string) => {
    const c = await login(ctx.app, telegramId, name);
    await c.call('PUT', '/me/roles', { roles: ['organizer'] });
    await c.call('PUT', '/me/organizer-profile', { displayName: name, cityId: moscow });
    return c;
  };
  const addVenue = async (by: TestClient, name: string) => {
    const res = await by.call('POST', '/venues', {
      kind: 'club',
      capacity: 50,
      name,
      address: 'ул. 1',
      cityId: moscow,
    });
    expect(res.statusCode).toBe(201);
    return res.json() as Venue;
  };
  const visible = async (by: TestClient) =>
    ((await by.call('GET', `/venues?city=${moscow}`)).json() as Venue[]).map((v) => v.id);
  const createEvent = (by: TestClient, venueId: string) =>
    by.call('POST', '/events', {
      venueId,
      title: 'Опен',
      format: 'open_mic',
      startsAtLocal: `${future}T19:00`,
      slotsCount: 5,
      setMinutes: 7,
    });
  const botStarted = async (c: TestClient) => {
    await ctx.db
      .update(schema.users)
      .set({ botStarted: true, botBlocked: false })
      .where(eq(schema.users.id, c.userId));
  };
  const sentTo = (c: TestClient) => ctx.sender.sent.filter((m) => m.chatId === c.telegramId);

  beforeAll(async () => {
    ctx = await setupTestApp();
    admin = await login(ctx.app, TEST_ADMIN_TELEGRAM_ID, 'Админ');
    const cities = (await admin.call('GET', '/cities')).json() as Array<{
      id: number;
      name: string;
    }>;
    moscow = cities.find((c) => c.name === 'Москва')!.id;
    await admin.call('PUT', '/me/roles', { roles: ['organizer'] });
    await admin.call('PUT', '/me/organizer-profile', { displayName: 'Админ', cityId: moscow });
    org = await organizer(base, `Орг ${base}`);
    other = await organizer(base + 1, `Другой ${base}`);
    await botStarted(admin);
    await botStarted(org);
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('первый админ — из ADMIN_TELEGRAM_IDS, остальным раздел не виден', async () => {
    expect((await admin.call('GET', '/me')).json().isAdmin).toBe(true);
    expect((await org.call('GET', '/me')).json().isAdmin).toBe(false);
    expect((await org.call('GET', '/admin/venues')).statusCode).toBe(404);
    expect((await org.call('GET', '/me/badges')).json().admin).toBe(0);
  });

  it('новая площадка: видит только автор, админ получает её на проверку', async () => {
    const venue = await addVenue(org, `Подвал ${base}`);
    expect(venue.status).toBe('pending');
    expect(await visible(org)).toContain(venue.id);
    expect(await visible(other)).not.toContain(venue.id);

    // Автор может сразу ставить её в события, другие — нет.
    expect((await createEvent(org, venue.id)).statusCode).toBe(201);
    expect((await createEvent(other, venue.id)).statusCode).toBe(400);

    const pending = (await admin.call('GET', '/admin/venues')).json() as PendingVenue[];
    const item = pending.find((p) => p.venue.id === venue.id);
    expect(item?.author?.name).toBe(`Орг ${base}`);
    expect(item?.cityName).toBe('Москва');
    expect((await admin.call('GET', '/me/badges')).json().admin).toBeGreaterThan(0);

    await ctx.deliver();
    expect(sentTo(admin).some((m) => m.text.includes(`Подвал ${base}`))).toBe(true);

    const res = await admin.call('POST', `/admin/venues/${venue.id}/approve`);
    expect(res.json()).toEqual({ result: 'approved' });
    expect(await visible(other)).toContain(venue.id);
    expect((await createEvent(other, venue.id)).statusCode).toBe(201);

    // В списке — кто добавил (связаться) и афиша: оба опубликованных события.
    const listed = (
      (await other.call('GET', `/venues?city=${moscow}`)).json() as VenueListItem[]
    ).find((v) => v.id === venue.id);
    expect(listed?.owner?.name).toBe(`Орг ${base}`);
    expect(listed?.kind).toBe('club');
    expect(listed?.afisha.total).toBe(2);
    expect(listed?.afisha.items[0]?.title).toBe('Опен');

    await ctx.deliver();
    expect(sentTo(org).some((m) => m.text.includes('проверена'))).toBe(true);

    // Повторно проверить нельзя.
    expect((await admin.call('POST', `/admin/venues/${venue.id}/reject`)).statusCode).toBe(409);
  });

  it('отказ без событий удаляет площадку', async () => {
    const venue = await addVenue(org, `Дубль ${base}`);
    const res = await admin.call('POST', `/admin/venues/${venue.id}/reject`, {
      reason: 'Это дубль',
    });
    expect(res.json()).toEqual({ result: 'deleted' });
    expect(await visible(org)).not.toContain(venue.id);
    const [row] = await ctx.db.select().from(schema.venues).where(eq(schema.venues.id, venue.id));
    expect(row).toBeUndefined();

    await ctx.deliver();
    const msg = sentTo(org).find((m) => m.text.includes(`Дубль ${base}`));
    expect(msg?.text).toContain('Это дубль');
    expect(msg?.text).toContain('удалена');
  });

  it('отказ при событиях скрывает площадку, события остаются', async () => {
    const venue = await addVenue(org, `Призрак ${base}`);
    const event = (await createEvent(org, venue.id)).json() as { id: string };
    const res = await admin.call('POST', `/admin/venues/${venue.id}/reject`, {
      reason: 'Такой нет',
    });
    expect(res.json()).toEqual({ result: 'rejected' });

    const mine = ((await org.call('GET', `/venues?city=${moscow}`)).json() as Venue[]).find(
      (v) => v.id === venue.id,
    );
    expect(mine?.status).toBe('rejected');
    expect(mine?.rejectReason).toBe('Такой нет');
    expect(await visible(other)).not.toContain(venue.id);

    // Новое событие на ней создать нельзя, старое редактируется.
    const again = await createEvent(org, venue.id);
    expect(again.statusCode).toBe(400);
    expect(again.json().error.message).toContain('отклонена');
    const edit = await org.call('PATCH', `/events/${event.id}`, { title: 'Опен 2' });
    expect(edit.statusCode).toBe(200);
  });

  it('мест в зале: указывается при создании, меняет только автор', async () => {
    const res = await org.call('POST', '/venues', {
      kind: 'club',
      name: `Зал ${base}`,
      address: 'ул. 2',
      cityId: moscow,
      capacity: 120,
    });
    const venue = res.json() as Venue;
    expect(venue.capacity).toBe(120);
    expect((await other.call('PATCH', `/venues/${venue.id}`, { capacity: 5 })).statusCode).toBe(
      403,
    );
    const patched = await org.call('PATCH', `/venues/${venue.id}`, { capacity: 90, kind: 'bar' });
    expect(patched.json()).toMatchObject({ capacity: 90, kind: 'bar' });
    expect((await org.call('PATCH', `/venues/${venue.id}`, { capacity: null })).statusCode).toBe(
      400,
    );
    expect((await org.call('PATCH', `/venues/${venue.id}`, { capacity: 0 })).statusCode).toBe(400);
  });

  it('площадка админа тоже идёт на проверку, подтвердить её может он сам', async () => {
    const venue = await addVenue(admin, `Админская ${base}`);
    expect(venue.status).toBe('pending');
    expect(await visible(other)).not.toContain(venue.id);
    expect((await admin.call('POST', `/admin/venues/${venue.id}/approve`)).statusCode).toBe(200);
    expect(await visible(other)).toContain(venue.id);
  });

  it('главный назначает админов, обычный админ — нет', async () => {
    expect((await admin.call('GET', '/me')).json().canManageAdmins).toBe(true);
    const found = (
      await admin.call('GET', `/admin/users?q=${encodeURIComponent(`Другой ${base}`)}`)
    ).json() as AdminPerson[];
    expect(found.map((p) => p.id)).toEqual([other.userId]);
    expect(found[0]!.isAdmin).toBe(false);

    await botStarted(other);
    expect((await admin.call('PUT', `/admin/admins/${other.userId}`)).statusCode).toBe(204);
    const me = (await other.call('GET', '/me')).json();
    expect(me.isAdmin).toBe(true);
    expect(me.canManageAdmins).toBe(false);
    await ctx.deliver();
    expect(sentTo(other).some((m) => m.text.includes('назначили администратором'))).toBe(true);

    // Обычный админ видит список, но назначать не может.
    const admins = (await other.call('GET', '/admin/admins')).json() as AdminPerson[];
    const owner = admins.find((a) => a.id === admin.userId);
    expect(owner).toMatchObject({ isOwner: true, canManageAdmins: true });
    expect((await other.call('PUT', `/admin/admins/${org.userId}`)).statusCode).toBe(403);

    // Право назначать: теперь может, но главного и себя не трогает.
    expect((await admin.call('PUT', `/admin/admins/${other.userId}/manage`)).statusCode).toBe(204);
    expect((await other.call('PUT', `/admin/admins/${org.userId}`)).statusCode).toBe(204);
    expect((await other.call('DELETE', `/admin/admins/${admin.userId}`)).statusCode).toBe(409);
    expect((await other.call('DELETE', `/admin/admins/${other.userId}`)).statusCode).toBe(409);
    expect((await other.call('DELETE', `/admin/admins/${org.userId}`)).statusCode).toBe(204);

    expect((await admin.call('DELETE', `/admin/admins/${other.userId}/manage`)).statusCode).toBe(
      204,
    );
    expect((await other.call('GET', '/me')).json()).toMatchObject({
      isAdmin: true,
      canManageAdmins: false,
    });
    expect((await admin.call('DELETE', `/admin/admins/${other.userId}`)).statusCode).toBe(204);
    expect((await other.call('GET', '/admin/venues')).statusCode).toBe(404);
  });
});
