import ICAL from 'ical.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, schema } from '@standup/db';
import { localToUtc } from '@standup/domain';
import {
  TEST_DATABASE_URL,
  login,
  setupTestApp,
  telegramIdBase,
  type TestClient,
} from './test-helpers';

// Этап 7: календарь комика, занятость, автопринятие, ICS.
describe.skipIf(!TEST_DATABASE_URL)('Календарь и автопринятие (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  const base = telegramIdBase();
  const day = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
  const at = (local: string) => localToUtc(`${day}T${local}`, 'Europe/Moscow');
  let moscow = 0;
  const all: TestClient[] = [];
  const venues: string[] = [];

  async function organizer(n: number, name: string) {
    const u = await login(ctx.app, base + n, name);
    all.push(u);
    await u.call('PUT', '/me/roles', { roles: ['organizer'] });
    await u.call('PUT', '/me/organizer-profile', {
      displayName: `${name} ${base}`,
      cityId: moscow,
    });
    const venue = (
      await u.call('POST', '/venues', {
        name: `Зал ${name} ${base}`,
        address: 'ул. 1',
        cityId: moscow,
      })
    ).json().id as string;
    venues.push(venue);
    return { ...u, venue };
  }

  async function comedian(n: number, name: string) {
    const u = await login(ctx.app, base + n, name);
    all.push(u);
    await u.call('PUT', '/me/roles', { roles: ['comedian'] });
    await u.call('PUT', '/me/comedian-profile', {
      stageName: `${name} ${base}`,
      cityId: moscow,
      contact: '@x',
    });
    return u;
  }

  async function event(
    org: Awaited<ReturnType<typeof organizer>>,
    time: string,
    format = 'open_mic',
  ) {
    return (
      await org.call('POST', '/events', {
        venueId: org.venue,
        title: `Шоу ${org.telegramId} ${time}`,
        format,
        startsAtLocal: `${day}T${time}`,
        slotsCount: 3,
        setMinutes: 10,
      })
    ).json().id as string;
  }

  beforeAll(async () => {
    ctx = await setupTestApp();
    const probe = await login(ctx.app, base + 99, 'Проба');
    all.push(probe);
    const cities = (await probe.call('GET', '/cities')).json() as Array<{
      id: number;
      name: string;
    }>;
    moscow = cities.find((c) => c.name === 'Москва')!.id;
  });

  afterAll(async () => {
    if (!ctx) return;
    const ids = all.map((u) => u.userId);
    await ctx.db.delete(schema.events).where(inArray(schema.events.organizerId, ids));
    await ctx.db.delete(schema.venues).where(inArray(schema.venues.id, venues));
    await ctx.db.delete(schema.users).where(inArray(schema.users.id, ids));
    await ctx.close();
  });

  it('гонка автопринятия: два одновременных приглашения на одно время → принято одно', async () => {
    const o1 = await organizer(1, 'Орг1');
    const o2 = await organizer(2, 'Орг2');
    const x = await comedian(3, 'Икс');
    for (const o of [o1, o2]) {
      const res = await x.call('PUT', `/me/auto-accept-rules/${o.userId}`, {});
      expect(res.statusCode).toBe(200);
    }
    expect((await x.call('GET', '/me/auto-accept-rules')).json()).toHaveLength(2);

    const e1 = await event(o1, '20:00');
    const e2 = await event(o2, '20:00');
    const [r1, r2] = await Promise.all([
      o1.call('POST', `/events/${e1}/invitations`, { comedianIds: [x.userId] }),
      o2.call('POST', `/events/${e2}/invitations`, { comedianIds: [x.userId] }),
    ]);
    const auto = [r1.json().autoAccepted, r2.json().autoAccepted].flat();
    expect(auto).toEqual([x.userId]);

    const rows = await ctx.db
      .select()
      .from(schema.participations)
      .where(eq(schema.participations.comedianId, x.userId));
    expect(rows.map((r) => r.status).sort()).toEqual(['accepted', 'invited']);
    expect(rows.find((r) => r.status === 'accepted')!.autoAccepted).toBe(true);

    // Организатор видит метку «подтверждён автоматически».
    const acceptedEvent = rows.find((r) => r.status === 'accepted')!.eventId;
    const owner = acceptedEvent === e1 ? o1 : o2;
    const lineup = (await owner.call('GET', `/events/${acceptedEvent}/lineup`)).json();
    expect(lineup.accepted[0]).toMatchObject({ autoAccepted: true, position: 1 });

    // Второе приглашение ждёт решения комика, причина — пересечение.
    const [pending] = await ctx.db
      .select()
      .from(schema.scheduledNotifications)
      .where(
        eq(
          schema.scheduledNotifications.participationId,
          rows.find((r) => r.status === 'invited')!.id,
        ),
      );
    expect(pending!.payload).toMatchObject({ autoAcceptReason: 'conflict' });
  });

  it('условия правила: формат, окно времени; выключенное правило не принимает', async () => {
    const o = await organizer(4, 'Орг3');
    const y = await comedian(5, 'Игрек');
    await y.call('PUT', `/me/auto-accept-rules/${o.userId}`, {
      formats: ['showcase'],
      timeFrom: '18:00',
      timeTo: '21:00',
    });
    const invite = async (eventId: string) =>
      (await o.call('POST', `/events/${eventId}/invitations`, { comedianIds: [y.userId] })).json();

    expect((await invite(await event(o, '19:00', 'open_mic'))).autoAccepted).toEqual([]);
    expect((await invite(await event(o, '22:00', 'showcase'))).autoAccepted).toEqual([]);
    expect((await invite(await event(o, '19:30', 'showcase'))).autoAccepted).toEqual([y.userId]);

    await y.call('PUT', `/me/auto-accept-rules/${o.userId}`, { enabled: false });
    expect((await invite(await event(o, '12:00', 'showcase'))).autoAccepted).toEqual([]);
    // Выключение правила не отменяет уже принятое.
    const accepted = await ctx.db
      .select()
      .from(schema.participations)
      .where(eq(schema.participations.comedianId, y.userId));
    expect(accepted.filter((p) => p.status === 'accepted')).toHaveLength(1);

    // Правило — только на организатора.
    expect((await y.call('PUT', `/me/auto-accept-rules/${y.userId}`, {})).statusCode).toBe(400);
  });

  it('мой календарь: выступления и занятость; занятость даёт пересечение', async () => {
    const o = await organizer(6, 'Орг4');
    const z = await comedian(7, 'Зет');
    await z.call('PUT', `/me/auto-accept-rules/${o.userId}`, {});
    const e = await event(o, '20:00');
    await o.call('POST', `/events/${e}/invitations`, { comedianIds: [z.userId] });

    const busy = await z.call('POST', '/me/busy-slots', {
      kind: 'busy',
      startsAtLocal: `${day}T22:00`,
      endsAtLocal: `${day}T23:30`,
      title: 'Репетиция',
    });
    expect(busy.statusCode).toBe(201);
    const manual = await z.call('POST', '/me/busy-slots', {
      kind: 'manual_gig',
      startsAtLocal: `${day}T18:00`,
      endsAtLocal: `${day}T18:30`,
      title: 'Корпоратив',
      venueText: 'Ресторан',
    });
    expect(manual.statusCode).toBe(201);

    const cal = (
      await z.call(
        'GET',
        `/me/calendar?from=${encodeURIComponent(at('00:00').toISOString())}&to=${encodeURIComponent(at('23:59').toISOString())}`,
      )
    ).json();
    expect(cal.timezone).toBe('Europe/Moscow');
    expect(cal.items.map((i: { type: string }) => i.type)).toEqual(['manual_gig', 'gig', 'busy']);
    expect(cal.items[1]).toMatchObject({ position: 1, autoAccepted: true });
    expect(cal.items[1].stageStart).toBe(at('20:00').toISOString());

    // Новое событие в 22:30 пересекается с занятостью 22:00–23:30 — автопринятие не сработает.
    const late = await event(o, '22:30');
    const res = (
      await o.call('POST', `/events/${late}/invitations`, { comedianIds: [z.userId] })
    ).json();
    expect(res.autoAccepted).toEqual([]);
    // Удалить занятость можно только свою.
    expect((await o.call('DELETE', `/me/busy-slots/${busy.json().id}`)).statusCode).toBe(404);
    expect((await z.call('DELETE', `/me/busy-slots/${busy.json().id}`)).statusCode).toBe(204);
  });

  it('ICS: ссылка на подписку, валидный календарь, перевыпуск токена', async () => {
    const o = await organizer(8, 'Орг5');
    const w = await comedian(9, 'Дабл');
    await w.call('PUT', `/me/auto-accept-rules/${o.userId}`, {});
    const e = await event(o, '19:00');
    await o.call('POST', `/events/${e}/invitations`, { comedianIds: [w.userId] });
    await w.call('POST', '/me/busy-slots', {
      kind: 'manual_gig',
      startsAtLocal: `${day}T21:00`,
      endsAtLocal: `${day}T21:30`,
      title: 'Свой концерт',
    });

    const feed = (await w.call('GET', '/me/calendar-feed')).json();
    expect(feed.url).toMatch(/^https:\/\/example\.test\/cal\/[\w-]{43}\.ics$/);
    expect(feed.webcalUrl).toBe(feed.url.replace('https://', 'webcal://'));
    // Повторный запрос — та же ссылка.
    expect((await w.call('GET', '/me/calendar-feed')).json().url).toBe(feed.url);

    const path = new URL(feed.url).pathname;
    const res = await ctx.app.inject({ method: 'GET', url: path });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    const comp = new ICAL.Component(ICAL.parse(res.body));
    const events = comp.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v));
    expect(events.map((x) => x.summary)).toEqual([
      `🎤 Шоу ${o.telegramId} 19:00 — Зал Орг5 ${base}`,
      '🎤 Свой концерт',
    ]);
    expect(events[0]!.description).toContain('№1 в составе');

    // Отмена события — запись остаётся со STATUS:CANCELLED.
    await o.call('POST', `/events/${e}/cancel`);
    const after = new ICAL.Component(
      ICAL.parse((await ctx.app.inject({ method: 'GET', url: path })).body),
    );
    const cancelled = after.getAllSubcomponents('vevent')[0]!;
    expect(cancelled.getFirstPropertyValue('status')).toBe('CANCELLED');

    // Перевыпуск — старая ссылка больше не работает.
    const rotated = (await w.call('POST', '/me/calendar-feed/rotate')).json();
    expect(rotated.url).not.toBe(feed.url);
    expect((await ctx.app.inject({ method: 'GET', url: path })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'GET', url: '/cal/nope.ics' })).statusCode).toBe(404);
  });
});
