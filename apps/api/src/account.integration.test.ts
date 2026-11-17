import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { eq, schema } from '@standup/db';
import { ru } from '@standup/shared';
import {
  TEST_DATABASE_URL,
  approveVenue,
  login,
  setupTestApp,
  telegramIdBase,
  type TestClient,
} from './test-helpers';

// SPEC §11: DELETE /me — удаление аккаунта с анонимизацией истории.
describe.skipIf(!TEST_DATABASE_URL)('API удаление аккаунта (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  const base = telegramIdBase();
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  let moscow = 0;
  let venueId = '';
  let org: TestClient;
  let comic: TestClient;
  let other: TestClient;

  const createEvent = async (by: TestClient, title: string) =>
    (
      await by.call('POST', '/events', {
        venueId,
        title,
        format: 'open_mic',
        startsAtLocal: `${future}T19:00`,
        slotsCount: 5,
        setMinutes: 7,
        recruitmentOpen: true,
      })
    ).json() as { id: string };

  beforeAll(async () => {
    ctx = await setupTestApp();
    org = await login(ctx.app, base, 'Орг');
    const cities = (await org.call('GET', '/cities')).json() as Array<{ id: number; name: string }>;
    moscow = cities.find((c) => c.name === 'Москва')!.id;
    await org.call('PUT', '/me/roles', { roles: ['organizer'] });
    await org.call('PUT', '/me/organizer-profile', { displayName: 'Орг', cityId: moscow });
    venueId = (
      await org.call('POST', '/venues', {
        kind: 'club',
        capacity: 50,
        name: `Зал ${base}`,
        address: 'ул. 1',
        cityId: moscow,
      })
    ).json().id;
    await approveVenue(ctx.db, venueId);

    comic = await login(ctx.app, base + 1, 'Комик');
    await comic.call('PUT', '/me/roles', { roles: ['comedian', 'organizer'] });
    await comic.call('PUT', '/me/comedian-profile', {
      stageName: `Удаляемый ${base}`,
      cityId: moscow,
      contact: '@secret_contact',
      bio: 'Био',
      links: [{ type: 'youtube', url: 'https://youtube.com/watch?v=x' }],
    });
    await comic.call('PUT', '/me/organizer-profile', { displayName: 'Комик-орг', cityId: moscow });

    other = await login(ctx.app, base + 2, 'Другой');
    await other.call('PUT', '/me/roles', { roles: ['comedian'] });
    await other.call('PUT', '/me/comedian-profile', {
      stageName: `Другой ${base}`,
      cityId: moscow,
      contact: '@other',
    });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('стирает данные, снимает с будущих выступлений и отменяет свои события', async () => {
    const png = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#cc3366' },
    })
      .png()
      .toBuffer();
    expect((await comic.upload('POST', '/me/photos', png)).statusCode).toBe(201);
    await comic.call('POST', '/me/busy-slots', {
      startsAtLocal: `${future}T12:00`,
      endsAtLocal: `${future}T13:00`,
      kind: 'busy',
    });
    await comic.call('GET', '/me/calendar-feed');

    // Комик в составе чужого события.
    const show = await createEvent(org, `Шоу ${base}`);
    const applied = (await comic.call('POST', `/events/${show.id}/applications`, {})).json();
    expect(
      (await org.call('POST', `/participations/${applied.id}/actions`, { action: 'accept' }))
        .statusCode,
    ).toBe(200);

    // Своё будущее событие, в котором уже записан другой комик.
    const own = await createEvent(comic, `Своё ${base}`);
    await other.call('POST', `/events/${own.id}/applications`, {});

    expect((await comic.call('DELETE', '/me')).statusCode).toBe(204);

    // Выданный JWT больше не работает.
    expect((await comic.call('GET', '/me')).statusCode).toBe(401);

    const [user] = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, comic.userId));
    expect(user!.deletedAt).not.toBeNull();
    expect(user!.telegramId).toBeLessThan(0);
    expect(user!.firstName).toBe(ru.app.account.deletedName);
    expect(user!.telegramUsername).toBeNull();

    const [profile] = await ctx.db
      .select()
      .from(schema.comedianProfiles)
      .where(eq(schema.comedianProfiles.userId, comic.userId));
    expect(profile).toMatchObject({
      stageName: ru.app.account.deletedName,
      contact: '',
      bio: null,
      links: [],
      isSearchable: false,
    });
    for (const table of [
      schema.comedianPhotos,
      schema.busySlots,
      schema.calendarFeeds,
      schema.userRoles,
    ]) {
      const rows = await ctx.db.select().from(table).where(eq(table.userId, comic.userId));
      expect(rows).toHaveLength(0);
    }

    // Снят с чужого события.
    const [p] = await ctx.db
      .select()
      .from(schema.participations)
      .where(eq(schema.participations.id, applied.id));
    expect(p!.status).toBe('withdrawn');

    // Своё событие отменено.
    const [ownRow] = await ctx.db.select().from(schema.events).where(eq(schema.events.id, own.id));
    expect(ownRow!.status).toBe('cancelled');

    // Комика больше нет в поиске.
    const found = (
      await org.call('GET', `/comedians?q=${encodeURIComponent(String(base))}`)
    ).json() as Array<{ id: string }>;
    expect(found.map((c) => c.id)).not.toContain(comic.userId);
  });

  it('повторный вход того же человека создаёт новый аккаунт', async () => {
    const again = await login(ctx.app, base + 1, 'Комик');
    expect(again.userId).not.toBe(comic.userId);
    const me = (await again.call('GET', '/me')).json();
    expect(me.roles).toEqual([]);
  });
});
