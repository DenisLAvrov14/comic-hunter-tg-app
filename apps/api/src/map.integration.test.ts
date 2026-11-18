import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { eq, schema } from '@standup/db';
import {
  TEST_DATABASE_URL,
  approveVenue,
  login,
  setupTestApp,
  telegramIdBase,
  type TestClient,
} from './test-helpers';

// Правки владельца продукта 10 ноября: «Карта», счётчики меню, лого и фото площадок,
// отказы в приглашениях, новые города и форматы.
describe.skipIf(!TEST_DATABASE_URL)('API карта, счётчики, площадки (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  const base = telegramIdBase();
  // Дата далеко в будущем, чтобы на «Карте» были только события этого файла.
  const day = new Date(Date.now() + 300 * 86_400_000 + (base % 50) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  let cities: Array<{ id: number; name: string; country: string; timezone: string }>;
  let org: TestClient;
  let a: TestClient;
  let b: TestClient;
  let venueId = '';
  const cityId = (name: string) => cities.find((c) => c.name === name)!.id;

  async function event(title: string, extra: object = {}) {
    const res = await org.call('POST', '/events', {
      venueId,
      title: `${title} ${base}`,
      format: 'tryout',
      startsAtLocal: `${day}T20:00`,
      slotsCount: 3,
      setMinutes: 15,
      recruitmentOpen: true,
      ...extra,
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string };
  }

  beforeAll(async () => {
    ctx = await setupTestApp();
    org = await login(ctx.app, base, 'Орг');
    cities = (await org.call('GET', '/cities')).json();
    await org.call('PUT', '/me/roles', { roles: ['organizer'] });
    await org.call('PUT', '/me/organizer-profile', {
      displayName: 'Орг',
      cityId: cityId('Тбилиси'),
    });
    venueId = (
      await org.call('POST', '/venues', {
        kind: 'club',
        capacity: 50,
        name: `Подвал ${base}`,
        address: 'пр. Руставели, 1',
        cityId: cityId('Тбилиси'),
      })
    ).json().id;
    await approveVenue(ctx.db, venueId);

    for (const [i, name] of ['А', 'Б'].entries()) {
      const c = await login(ctx.app, base + 1 + i, name);
      await c.call('PUT', '/me/roles', { roles: ['comedian'] });
      await c.call('PUT', '/me/comedian-profile', {
        stageName: `${name} ${base}`,
        cityId: cityId('Тбилиси'),
        contact: `@c${i}`,
        links: [
          { type: 'telegram', url: 'https://t.me/c' },
          { type: 'video', url: 'https://youtube.com/watch?v=1' },
        ],
      });
      if (i === 0) a = c;
      else b = c;
    }
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('новые города сгруппированы по странам с таймзонами', () => {
    expect(cities.find((c) => c.name === 'Ташкент')).toMatchObject({
      country: 'UZ',
      timezone: 'Asia/Tashkent',
    });
    expect(cities.find((c) => c.name === 'Нальчик')).toMatchObject({ country: 'RU' });
    expect(cities.find((c) => c.name === 'Барселона')).toMatchObject({
      country: 'ES',
      timezone: 'Europe/Madrid',
    });
  });

  it('«Карта»: события города на дату с составом, черновики и скрытый состав — нет', async () => {
    const open = await event('Проверка');
    await event('Черновик', { status: 'draft' });
    const hidden = await event('Закрытый', { recruitmentOpen: false, showLineup: false });
    await org.call('POST', `/events/${open.id}/invitations`, { comedianIds: [a.userId] });
    const inv = (await a.call('GET', '/me/inbox')).json().invitations[0];
    await a.call('POST', `/participations/${inv.participation.id}/actions`, { action: 'accept' });

    const res = await b.call('GET', `/map?city=${cityId('Тбилиси')}&date=${day}`);
    expect(res.statusCode).toBe(200);
    // Тестовая БД общая: берём только события этого прогона.
    const items = (res.json() as Array<{ title: string }>).filter((e) =>
      e.title.endsWith(` ${base}`),
    ) as Array<{
      id: string;
      title: string;
      format: string;
      lineup: Array<{ comedianId: string; position: number; stageName: string }> | null;
    }>;
    expect(items.map((e) => e.id).sort()).toEqual([open.id, hidden.id].sort());
    const shown = items.find((e) => e.id === open.id)!;
    expect(shown.format).toBe('tryout');
    expect(shown.lineup).toEqual([
      expect.objectContaining({ position: 1, comedianId: a.userId, stageName: `А ${base}` }),
    ]);
    expect(items.find((e) => e.id === hidden.id)!.lineup).toBeNull();

    // Другой город — пусто; «Все города» — тоже находит (дата по времени площадки).
    const minsk = (await b.call('GET', `/map?city=${cityId('Минск')}&date=${day}`)).json();
    expect(minsk.map((e: { id: string }) => e.id)).not.toContain(open.id);
    const all = (await b.call('GET', `/map?date=${day}`)).json() as Array<{ id: string }>;
    expect(all.map((e) => e.id)).toContain(open.id);

    // Событие без открытого набора можно открыть с «Карты», но не подать заявку.
    const details = (await b.call('GET', `/events/${hidden.id}`)).json();
    expect(details.viewer.canApply).toBe(false);
  });

  it('фото в поиске — своё у каждого: без фото не подставляется чужое', async () => {
    const png = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#3366cc' },
    })
      .png()
      .toBuffer();
    expect((await a.upload('POST', '/me/photos', png)).statusCode).toBe(201);
    const found = (
      await org.call('GET', `/comedians?q=${encodeURIComponent(String(base))}`)
    ).json() as Array<{ id: string; photoUrl: string | null }>;
    expect(found.find((c) => c.id === a.userId)?.photoUrl).toContain(`/photos/${a.userId}/`);
    expect(found.find((c) => c.id === b.userId)?.photoUrl).toBeNull();
  });

  it('профиль комика с «Карты» видят все, контакт — только организаторы', async () => {
    const forComedian = (await b.call('GET', `/comedians/${a.userId}`)).json();
    expect(forComedian.contact).toBeNull();
    expect(forComedian.links).toHaveLength(2);
    const forOrganizer = (await org.call('GET', `/comedians/${a.userId}`)).json();
    expect(forOrganizer.contact).toBe('@c0');
    // Опыт не заполнен — пусто, без оценки.
    expect(forOrganizer).toMatchObject({
      startedYear: null,
      totalGigsEstimate: null,
      setLengths: [],
      languages: [],
    });
    await a.call('PUT', '/me/comedian-profile', {
      stageName: `А ${base}`,
      cityId: cityId('Тбилиси'),
      contact: '@c0',
      startedYear: 2024,
      gigsPerMonth: 4,
      setLengths: [5, 10],
      languages: ['ru', 'en'],
    });
    expect((await b.call('GET', `/comedians/${a.userId}`)).json()).toMatchObject({
      startedYear: 2024,
      gigsPerMonth: 4,
      setLengths: [5, 10],
      languages: ['ru', 'en'],
    });
  });

  it('счётчики меню: приглашения, заявки, приглашения вести', async () => {
    const e = await event('Счётчики');
    const before = (await b.call('GET', '/me/badges')).json();
    await org.call('POST', `/events/${e.id}/invitations`, { comedianIds: [b.userId] });
    expect((await b.call('GET', '/me/badges')).json().inbox).toBe(before.inbox + 1);

    const orgBefore = (await org.call('GET', '/me/badges')).json().events;
    await a.call('POST', `/events/${e.id}/applications`, {});
    expect((await org.call('GET', '/me/badges')).json().events).toBe(orgBefore + 1);
    const mine = (await org.call('GET', '/me/events')).json() as Array<{
      id: string;
      awaitingCount: number;
    }>;
    expect(mine.find((x) => x.id === e.id)!.awaitingCount).toBe(1);
  });

  it('отказ от приглашения: из «Приглашений» в закрытые; истёкшие — тоже', async () => {
    const e = await event('Отказ');
    await org.call('POST', `/events/${e.id}/invitations`, { comedianIds: [a.userId, b.userId] });
    const inv = (await b.call('GET', '/me/inbox')).json().invitations as Array<{
      event: { id: string };
      participation: { id: string };
    }>;
    const mine = inv.find((i) => i.event.id === e.id)!;
    const declined = await b.call('POST', `/participations/${mine.participation.id}/actions`, {
      action: 'decline',
    });
    expect(declined.json().status).toBe('declined');
    let lineup = (await org.call('GET', `/events/${e.id}/lineup`)).json();
    expect(lineup.invitations.map((i: { comedian: { id: string } }) => i.comedian.id)).toEqual([
      a.userId,
    ]);
    expect(lineup.closed).toEqual([
      expect.objectContaining({
        status: 'declined',
        comedian: expect.objectContaining({ id: b.userId }),
      }),
    ]);

    // Событие началось, а А так и не ответил: приглашение больше не «ждёт ответа».
    await ctx.db
      .update(schema.events)
      .set({ startsAt: new Date(Date.now() - 3_600_000) })
      .where(eq(schema.events.id, e.id));
    lineup = (await org.call('GET', `/events/${e.id}/lineup`)).json();
    expect(lineup.invitations).toEqual([]);
    expect(lineup.closed.map((i: { status: string }) => i.status).sort()).toEqual([
      'declined',
      'invited',
    ]);
  });

  it('принял, потом убрал: у комика больше нет участия ни во «Входящих», ни в календаре', async () => {
    const e = await event('Убрали', { startsAtLocal: `${day}T12:00` });
    await a.call('POST', `/events/${e.id}/applications`, {});
    const app = (await org.call('GET', `/events/${e.id}/lineup`)).json().applications[0];
    const act = (action: string) =>
      org.call('POST', `/participations/${app.id}/actions`, { action });
    expect((await act('accept')).json().status).toBe('accepted');
    expect((await act('remove')).json().status).toBe('removed');

    const inbox = (await a.call('GET', '/me/inbox')).json();
    const all = [...inbox.invitations, ...inbox.applications] as Array<{ event: { id: string } }>;
    expect(all.map((i) => i.event.id)).not.toContain(e.id);
    const from = encodeURIComponent(new Date(`${day}T00:00:00Z`).toISOString());
    const to = encodeURIComponent(new Date(`${day}T23:59:00Z`).toISOString());
    const cal = (await a.call('GET', `/me/calendar?from=${from}&to=${to}`)).json();
    expect(cal.items.map((i: { eventId?: string }) => i.eventId)).not.toContain(e.id);
    const card = (await a.call('GET', `/events/${e.id}`)).json();
    expect(card.viewer.participation.status).toBe('removed');
    expect(card.lineup).toEqual([]);
  });

  it('своё выступление ставится «час в час» без проверки пересечений', async () => {
    const first = await a.call('POST', '/me/busy-slots', {
      kind: 'manual_gig',
      startsAtLocal: `${day}T18:00`,
      endsAtLocal: `${day}T20:00`,
    });
    const second = await a.call('POST', '/me/busy-slots', {
      kind: 'manual_gig',
      startsAtLocal: `${day}T19:00`,
      endsAtLocal: `${day}T21:00`,
    });
    expect([first.statusCode, second.statusCode]).toEqual([201, 201]);
  });

  it('лого и фото площадки: загружает и убирает только автор', async () => {
    const png = await sharp({
      create: { width: 800, height: 400, channels: 3, background: '#ff8800' },
    })
      .png()
      .toBuffer();
    expect((await b.upload('PUT', `/venues/${venueId}/logo`, png)).statusCode).toBe(403);

    const res = await org.upload('PUT', `/venues/${venueId}/logo`, png);
    expect(res.statusCode).toBe(200);
    const venue = res.json();
    expect(venue.canEdit).toBe(true);
    expect(venue.logoUrl).toMatch(/^\/media\/photos\/venues\//);
    // Фото — галерея: добавляются по одному, удаляются по отдельности.
    expect((await b.upload('POST', `/venues/${venueId}/photos`, png)).statusCode).toBe(403);
    const added = await org.upload('POST', `/venues/${venueId}/photos`, png);
    expect(added.statusCode).toBe(201);
    expect(added.json().photos[0].previewUrl).toMatch(/_400\.jpg$/);
    const two = (await org.upload('POST', `/venues/${venueId}/photos`, png)).json();
    expect(two.photos).toHaveLength(2);
    const left = (await org.call('DELETE', `/venues/${venueId}/photos/${two.photos[0].id}`)).json();
    expect(left.photos.map((p: { id: string }) => p.id)).toEqual([two.photos[1].id]);

    const row = (
      await ctx.db.select().from(schema.venues).where(eq(schema.venues.id, venueId))
    )[0]!;
    expect(row.logoS3Key).toBeTruthy();

    const list = (await b.call('GET', `/venues?city=${cityId('Тбилиси')}`)).json() as Array<{
      id: string;
      logoUrl: string | null;
      canEdit: boolean;
    }>;
    expect(list.find((v) => v.id === venueId)).toMatchObject({
      logoUrl: venue.logoUrl,
      canEdit: false,
    });

    const cleared = (await org.call('DELETE', `/venues/${venueId}/logo`)).json();
    expect(cleared.logoUrl).toBeNull();
    expect(cleared.photos).toHaveLength(1);
  });
});
