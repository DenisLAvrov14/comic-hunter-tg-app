import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, schema } from '@standup/db';
import {
  TEST_DATABASE_URL,
  login,
  setupTestApp,
  telegramIdBase,
  type TestClient,
} from './test-helpers';

// Этап 5: состав, ведущие, замена, рассылка, афиша.
describe.skipIf(!TEST_DATABASE_URL)('API состав (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  const base = telegramIdBase();
  const day = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  let venueId = '';
  let org: TestClient;
  let host: TestClient;
  const comics: TestClient[] = [];
  let eventId = '';

  const act = (u: TestClient, id: string, action: string) =>
    u.call('POST', `/participations/${id}/actions`, { action });
  const lineup = async (u: TestClient = org) =>
    (await u.call('GET', `/events/${eventId}/lineup`)).json();
  const allPerms = {
    can_reorder: true,
    can_mark_attendance: true,
    can_call_reserve: true,
    can_notify_lineup: true,
  };

  beforeAll(async () => {
    ctx = await setupTestApp();
    org = await login(ctx.app, base, 'Орг');
    const cities = (await org.call('GET', '/cities')).json() as Array<{ id: number; name: string }>;
    const moscow = cities.find((c) => c.name === 'Москва')!.id;
    await org.call('PUT', '/me/roles', { roles: ['organizer'] });
    await org.call('PUT', '/me/organizer-profile', { displayName: 'Орг', cityId: moscow });
    venueId = (
      await org.call('POST', '/venues', { name: `Зал ${base}`, address: 'ул. 5', cityId: moscow })
    ).json().id;

    host = await login(ctx.app, base + 1, 'Ведущий');
    await host.call('PUT', '/me/roles', { roles: ['host'] });

    for (let i = 0; i < 5; i++) {
      const c = await login(ctx.app, base + 10 + i, `Комик${i}`);
      await c.call('PUT', '/me/roles', { roles: ['comedian'] });
      await c.call('PUT', '/me/comedian-profile', {
        stageName: `Комик${i} ${base}`,
        cityId: moscow,
        contact: `@c${i}`,
        links: i === 0 ? [{ type: 'youtube', url: 'https://youtube.com/watch?v=c0' }] : undefined,
      });
      comics.push(c);
    }
    // Все запускали бота — рассылка до них дойдёт.
    await ctx.db
      .update(schema.users)
      .set({ botStarted: true })
      .where(
        inArray(
          schema.users.id,
          comics.map((c) => c.userId),
        ),
      );

    eventId = (
      await org.call('POST', '/events', {
        venueId,
        title: `Шоу ${base}`,
        format: 'showcase',
        startsAtLocal: `${day}T19:00`,
        slotsCount: 3,
        setMinutes: 10,
        conditions: 'Гонорар 1000 ₽',
        recruitmentOpen: true,
      })
    ).json().id;
    // Трое в составе, двое в резерве.
    await org.call('POST', `/events/${eventId}/invitations`, {
      comedianIds: comics.slice(0, 3).map((c) => c.userId),
    });
    for (const c of comics.slice(0, 3)) {
      const inbox = (await c.call('GET', '/me/inbox')).json();
      await act(c, inbox.invitations[0].participation.id, 'accept');
    }
    for (const c of comics.slice(3)) {
      const p = (await c.call('POST', `/events/${eventId}/applications`, {})).json();
      await act(org, p.id, 'reserve');
    }
  });

  afterAll(async () => {
    if (!ctx) return;
    const ids = [org, host, ...comics].map((u) => u.userId);
    await ctx.db.delete(schema.events).where(inArray(schema.events.organizerId, ids));
    await ctx.db.delete(schema.venues).where(inArray(schema.venues.id, [venueId]));
    await ctx.db.delete(schema.users).where(inArray(schema.users.id, ids));
    await ctx.close();
  });

  it('ведущий без can_reorder не меняет порядок через API', async () => {
    // Не в штате — событие не видно.
    const l = await lineup();
    const order = l.accepted.map((x: { id: string }) => x.id).reverse();
    expect(
      (await host.call('PATCH', `/events/${eventId}/lineup/order`, { order, version: l.version }))
        .statusCode,
    ).toBe(404);

    const assigned = await org.call('PUT', `/events/${eventId}/staff/${host.userId}`, {
      permissions: { ...allPerms, can_reorder: false },
    });
    expect(assigned.json().staff).toMatchObject([{ userId: host.userId, name: 'Ведущий' }]);
    const res = await host.call('PATCH', `/events/${eventId}/lineup/order`, {
      order,
      version: l.version,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    // Ведущий видит состав и своё право в событии.
    expect((await host.call('GET', `/events/${eventId}/lineup`)).statusCode).toBe(200);
    const details = (await host.call('GET', `/events/${eventId}`)).json();
    expect(details.viewer.staffPermissions).toMatchObject({ can_reorder: false });
    expect((await host.call('GET', '/me/hosting')).json().map((e: { id: string }) => e.id)).toEqual(
      [eventId],
    );
  });

  it('организатор и ведущий меняют порядок одновременно → второй получает конфликт версии', async () => {
    await org.call('PUT', `/events/${eventId}/staff/${host.userId}`, { permissions: allPerms });
    const l = await lineup();
    const ids: string[] = l.accepted.map((x: { id: string }) => x.id);

    const first = await org.call('PATCH', `/events/${eventId}/lineup/order`, {
      order: [ids[2], ids[0], ids[1]],
      version: l.version,
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().accepted.map((x: { id: string }) => x.id)).toEqual([
      ids[2],
      ids[0],
      ids[1],
    ]);

    // Ведущий отправляет порядок со старой версией.
    const second = await host.call('PATCH', `/events/${eventId}/lineup/order`, {
      order: [ids[1], ids[2], ids[0]],
      version: l.version,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({
      code: 'VERSION_MISMATCH',
      details: { version: first.json().version },
    });
    // Перезагрузил состав — видит актуальный порядок и может менять дальше.
    const fresh = await lineup(host);
    expect(fresh.accepted.map((x: { id: string }) => x.id)).toEqual([ids[2], ids[0], ids[1]]);
    const third = await host.call('PATCH', `/events/${eventId}/lineup/order`, {
      order: [ids[0], ids[1], ids[2]],
      version: fresh.version,
    });
    expect(third.statusCode).toBe(200);
    // Порядок с чужим id — отклоняется.
    expect(
      (
        await org.call('PATCH', `/events/${eventId}/lineup/order`, {
          order: [ids[0], ids[1], comics[3]!.userId],
          version: third.json().version,
        })
      ).statusCode,
    ).toBe(409);
  });

  it('ведущий отмечает присутствие', async () => {
    const l = await lineup();
    const res = await host.call('POST', `/participations/${l.accepted[0].id}/attendance`, {
      value: 'present',
    });
    expect(res.statusCode).toBe(200);
    expect((await lineup()).accepted[0].attendance).toBe('present');
    // Комик не отмечает.
    expect(
      (
        await comics[0]!.call('POST', `/participations/${l.accepted[0].id}/attendance`, {
          value: 'absent',
        })
      ).statusCode,
    ).toBe(404);
  });

  it('замена: резервисты позваны срочно, первый принявший занимает позицию выбывшего', async () => {
    let l = await lineup();
    const dropped = l.accepted[1];
    const reserveIds = l.reserve.map((x: { id: string }) => x.id);
    ctx.sender.sent.length = 0;

    const res = await host.call('POST', `/events/${eventId}/replacement`, {
      participationId: dropped.id,
      reserveIds,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reserve.every((x: { isUrgent: boolean }) => x.isUrgent)).toBe(true);
    // Срочный вызов идёт через очередь уведомлений — сообщения ушли обоим резервистам.
    await ctx.deliver();
    ctx.sender.sent.splice(
      0,
      ctx.sender.sent.length,
      ...ctx.sender.sent.filter((m) => m.text.includes('замена')),
    );
    expect(ctx.sender.sent.map((m) => m.chatId).sort()).toEqual(
      comics
        .slice(3)
        .map((c) => c.telegramId)
        .sort(),
    );
    expect(ctx.sender.sent[0]!.text).toContain('замена');

    // Резервист видит срочный вызов и принимает его.
    const r3 = comics[3]!;
    const p3 = (await r3.call('GET', `/events/${eventId}`)).json().viewer.participation;
    expect(p3).toMatchObject({ status: 'reserve', isUrgent: true });
    const accepted = await act(r3, p3.id, 'accept');
    expect(accepted.json()).toMatchObject({ status: 'accepted', position: dropped.position });

    l = await lineup();
    expect(l.accepted.map((x: { comedian: { id: string } }) => x.comedian.id)).toContain(r3.userId);
    expect(l.accepted).toHaveLength(3);
    expect(l.closed.find((x: { id: string }) => x.id === dropped.id).status).toBe('removed');

    // Второй резервист опоздал: вызов уже закрыт.
    const p4 = (await comics[4]!.call('GET', `/events/${eventId}`)).json().viewer.participation;
    expect(p4).toMatchObject({ status: 'reserve', isUrgent: false });
    expect((await act(comics[4]!, p4.id, 'accept')).json().error.code).toBe('INVALID_TRANSITION');
  });

  it('рассылка составу: заблокировавший бота помечается', async () => {
    ctx.sender.sent.length = 0;
    ctx.sender.blocked.add(comics[0]!.telegramId);
    await ctx.deliver();
    ctx.sender.sent.length = 0;
    const res = await host.call('POST', `/events/${eventId}/broadcast`, { text: 'Сбор в 18:30' });
    expect(res.json()).toEqual({ queued: 3, skipped: 0 });
    await ctx.deliver();
    const broadcast = ctx.sender.sent.filter((m) => m.text.includes('Сбор в 18:30'));
    expect(broadcast).toHaveLength(2);
    const [blocked] = await ctx.db
      .select()
      .from(schema.users)
      .where(inArray(schema.users.id, [comics[0]!.userId]));
    expect(blocked!.botBlocked).toBe(true);
    // Без права рассылки — нельзя.
    await org.call('PUT', `/events/${eventId}/staff/${host.userId}`, {
      permissions: { ...allPerms, can_notify_lineup: false },
    });
    expect(
      (await host.call('POST', `/events/${eventId}/broadcast`, { text: 'x' })).statusCode,
    ).toBe(403);
  });

  it('текст для афиши: состав в порядке выхода, ведущий, условия', async () => {
    const text = (await org.call('GET', `/events/${eventId}/poster-text`)).json().text as string;
    expect(text).toContain(`🎤 Шоу ${base}`);
    expect(text).toContain('🎙 Ведущий: Ведущий');
    expect(text).toContain(`1. Комик0 ${base} — https://youtube.com/watch?v=c0`);
    expect(text).toContain('Гонорар 1000 ₽');
    expect((await comics[1]!.call('GET', `/events/${eventId}/poster-text`)).statusCode).toBe(404);
  });

  it('снятие ведущего закрывает доступ', async () => {
    await org.call('DELETE', `/events/${eventId}/staff/${host.userId}`);
    expect((await host.call('GET', `/events/${eventId}/lineup`)).statusCode).toBe(404);
    // Назначить можно только пользователя с ролью ведущего.
    expect(
      (
        await org.call('PUT', `/events/${eventId}/staff/${comics[1]!.userId}`, {
          permissions: allPerms,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await org.call('GET', '/hosts?q=Ведущий')).json().map((h: { userId: string }) => h.userId),
    ).toContain(host.userId);
  });
});
