import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, schema } from '@standup/db';
import { localToUtc } from '@standup/domain';
import {
  TEST_DATABASE_URL,
  login,
  setupTestApp,
  telegramIdBase,
  type TestClient,
} from './test-helpers';

// Этап 6: уведомления дня выступления с подменой времени.
describe.skipIf(!TEST_DATABASE_URL)('Уведомления (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  const base = telegramIdBase();
  const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
  const at = (local: string) => localToUtc(`${day}T${local}`, 'Europe/Moscow');
  let moscow = 0;
  let venueId = '';
  let org: TestClient;
  const users: TestClient[] = [];

  async function comedian(n: number, name: string) {
    const u = await login(ctx.app, base + n, name);
    await u.call('PUT', '/me/roles', { roles: ['comedian'] });
    await u.call('PUT', '/me/comedian-profile', {
      stageName: `${name} ${base}`,
      cityId: moscow,
      contact: `@${name}`,
    });
    await ctx.db
      .update(schema.users)
      .set({ botStarted: true })
      .where(eq(schema.users.id, u.userId));
    users.push(u);
    return u;
  }

  async function event(time: string, title: string) {
    const res = await org.call('POST', '/events', {
      venueId,
      title,
      format: 'open_mic',
      startsAtLocal: `${day}T${time}`,
      slotsCount: 2,
      setMinutes: 10,
      recruitmentOpen: true,
    });
    return res.json().id as string;
  }

  /** Комик подаёт заявку, организатор принимает (или ставит в резерв). */
  async function join(u: TestClient, eventId: string, action: 'accept' | 'reserve' = 'accept') {
    const p = (await u.call('POST', `/events/${eventId}/applications`, {})).json();
    const res = await org.call('POST', `/participations/${p.id}/actions`, { action });
    expect(res.statusCode, res.body).toBe(200);
    return p.id as string;
  }

  const sentTo = (u: TestClient) => ctx.sender.sent.filter((m) => m.chatId === u.telegramId);
  const pending = (participationId: string) =>
    ctx.db
      .select()
      .from(schema.scheduledNotifications)
      .where(
        and(
          eq(schema.scheduledNotifications.participationId, participationId),
          eq(schema.scheduledNotifications.status, 'pending'),
        ),
      );

  beforeAll(async () => {
    ctx = await setupTestApp();
    org = await login(ctx.app, base, 'Орг');
    users.push(org);
    const cities = (await org.call('GET', '/cities')).json() as Array<{ id: number; name: string }>;
    moscow = cities.find((c) => c.name === 'Москва')!.id;
    await org.call('PUT', '/me/roles', { roles: ['organizer'] });
    await org.call('PUT', '/me/organizer-profile', { displayName: 'Орг', cityId: moscow });
    await ctx.db
      .update(schema.users)
      .set({ botStarted: true })
      .where(eq(schema.users.id, org.userId));
    venueId = (
      await org.call('POST', '/venues', { name: `Сцена ${base}`, address: 'ул. 7', cityId: moscow })
    ).json().id;
  });

  afterAll(async () => {
    if (!ctx) return;
    const ids = users.map((u) => u.userId);
    await ctx.db.delete(schema.events).where(inArray(schema.events.organizerId, ids));
    await ctx.db.delete(schema.venues).where(eq(schema.venues.id, venueId));
    await ctx.db.delete(schema.users).where(inArray(schema.users.id, ids));
    await ctx.close();
  });

  it('день выступления: дайджест → повтор → алерт → «Позвать резерв» → резервист занял место', async () => {
    const a = await comedian(1, 'Аня');
    const r = await comedian(2, 'Резерв');
    const eventId = await event('20:00', `Шоу ${base}`);
    const pa = await join(a, eventId);
    const pr = await join(r, eventId, 'reserve');

    // Сразу: «вы в составе», «вы в резерве». «Новые заявки» организатору не уходят —
    // к моменту отправки обе заявки уже разобраны.
    await ctx.deliver();
    expect(sentTo(a)[0]!.text).toContain('Вы в составе');
    expect(sentTo(r)[0]!.text).toContain('резерве');
    expect(sentTo(org).some((m) => m.text.includes('Новые заявки'))).toBe(false);
    ctx.sender.sent.length = 0;

    // 09:59 — ещё рано.
    await ctx.deliver(at('09:59'));
    expect(sentTo(a)).toHaveLength(0);

    // 10:00 по Москве — дайджест с кнопками подтверждения.
    await ctx.deliver(at('10:00'));
    const digest = sentTo(a)[0]!;
    expect(digest.text).toContain(`Шоу ${base}`);
    expect(digest.text).toContain('№1 в составе, выход ~20:00');
    expect(digest.buttons![0]!.map((b) => b.callbackData)).toEqual([`dc:${pa}:y`, `dc:${pa}:n`]);

    // Нет ответа → через 2 часа повтор.
    await ctx.deliver(at('11:59'));
    expect(sentTo(a)).toHaveLength(1);
    await ctx.deliver(at('12:00'));
    expect(sentTo(a)[1]!.text).toContain('подтвердите участие');

    // За 3 часа до начала — алерт организатору с «Позвать резерв».
    await ctx.deliver(at('17:00'));
    const alert = sentTo(org).at(-1)!;
    expect(alert.text).toContain('Не подтвердил участие');
    expect(alert.text).toContain('@Аня');
    expect(alert.buttons![0]![0]!.callbackData).toBe(`rr:${pa}`);

    // Организатор нажал «Позвать резерв» → резервист получил срочный вызов.
    const call = await org.call('POST', `/participations/${pa}/call-reserve`);
    expect(call.json()).toEqual({ called: 1 });
    await ctx.deliver(at('17:01'));
    const urgent = sentTo(r).at(-1)!;
    expect(urgent.text).toContain('Срочно нужна замена');
    expect(urgent.buttons![0]![0]!.callbackData).toBe(`iv:${pr}:a`);

    // Резервист принял — занял позицию выбывшей, выбывшая убрана из состава.
    const accepted = await r.call('POST', `/participations/${pr}/actions`, { action: 'accept' });
    expect(accepted.json()).toMatchObject({ status: 'accepted', position: 1 });
    await ctx.deliver(at('17:02'));
    expect(sentTo(a).at(-1)!.text).toContain('убрали из состава');

    // У выбывшей больше нет ожидающих напоминаний, у резервиста — напоминание перед выходом.
    expect(await pending(pa)).toHaveLength(0);
    expect((await pending(pr)).map((n) => [n.kind, n.sendAt.toISOString()])).toContainEqual([
      'pre_show_reminder',
      at('19:30').toISOString(),
    ]);
    await ctx.deliver(at('19:30'));
    expect(sentTo(r).at(-1)!.text).toContain('Через 30 мин ваш выход');
  });

  it('перенос события на час переносит все ожидающие уведомления', async () => {
    const b = await comedian(3, 'Боря');
    const eventId = await event('20:00', `Перенос ${base}`);
    const pb = await join(b, eventId);
    await ctx.deliver();
    const before = Object.fromEntries((await pending(pb)).map((n) => [n.kind, n.sendAt.getTime()]));
    expect(Object.keys(before).sort()).toEqual([
      'day_digest',
      'day_digest_repeat',
      'pre_show_reminder',
      'unconfirmed_alert',
    ]);

    const res = await org.call('PATCH', `/events/${eventId}`, { startsAtLocal: `${day}T21:00` });
    expect(res.statusCode).toBe(200);
    const after = Object.fromEntries((await pending(pb)).map((n) => [n.kind, n.sendAt.getTime()]));
    // Привязанные к началу шоу сдвигаются на час; дайджест привязан к дню — остаётся в 10:00.
    for (const kind of ['pre_show_reminder', 'unconfirmed_alert']) {
      expect(after[kind]! - before[kind]!).toBe(3_600_000);
    }
    for (const kind of ['day_digest', 'day_digest_repeat']) expect(after[kind]).toBe(before[kind]);

    // Участнику — сообщение об изменении.
    ctx.sender.sent.length = 0;
    await ctx.deliver();
    expect(sentTo(b).some((m) => m.text.includes('Изменения в событии'))).toBe(true);

    // Отмена события отменяет всё ожидающее.
    await org.call('POST', `/events/${eventId}/cancel`);
    expect(await pending(pb)).toHaveLength(0);
  });

  it('один дайджест на день при нескольких выступлениях; «Не смогу» → алерт организатору', async () => {
    const c = await comedian(4, 'Вера');
    const e1 = await event('19:00', `Первое ${base}`);
    const e2 = await event('22:00', `Второе ${base}`);
    await join(c, e1);
    const p2 = await join(c, e2);
    ctx.sender.sent.length = 0;
    await ctx.deliver(at('10:00'));
    const digests = sentTo(c).filter((m) => m.text.includes('Сегодня у вас выступления'));
    expect(digests).toHaveLength(1);
    expect(digests[0]!.text).toContain(`Первое ${base}`);
    expect(digests[0]!.text).toContain(`Второе ${base}`);
    expect(digests[0]!.buttons).toHaveLength(2);

    // «Не смогу» на втором — организатору сразу алерт.
    const res = await c.call('POST', `/participations/${p2}/day-confirmation`, {
      value: 'declined',
    });
    expect(res.statusCode).toBe(200);
    await ctx.deliver(at('10:05'));
    const alert = sentTo(org).at(-1)!;
    expect(alert.text).toContain('снял участие');
    expect(alert.buttons![0]![0]!.callbackData).toBe(`rr:${p2}`);
    // Напоминание перед выходом для отказавшегося — отменено.
    expect((await pending(p2)).map((n) => n.kind)).not.toContain('pre_show_reminder');
  });

  it('403 от Telegram помечает пользователя как заблокировавшего бота', async () => {
    const d = await comedian(5, 'Гоша');
    const eventId = await event('18:00', `Блок ${base}`);
    await join(d, eventId);
    ctx.sender.blocked.add(d.telegramId);
    await ctx.deliver();
    const [user] = await ctx.db.select().from(schema.users).where(eq(schema.users.id, d.userId));
    expect(user!.botBlocked).toBe(true);
    const failed = await ctx.db
      .select()
      .from(schema.scheduledNotifications)
      .where(eq(schema.scheduledNotifications.userId, d.userId));
    expect(failed.find((n) => n.kind === 'application_accepted')).toMatchObject({
      status: 'failed',
      lastError: 'bot_blocked',
    });
    // Дальше не шлём: дайджест пропускается без попытки отправки.
    ctx.sender.blocked.clear();
    await ctx.deliver(at('10:00'));
    expect(sentTo(d)).toHaveLength(0);
  });

  it('внутренний вход бота: действие от имени пользователя только с секретом', async () => {
    const e = await comedian(6, 'Жора');
    const eventId = await event('21:30', `Бот ${base}`);
    const pe = await join(e, eventId);
    await ctx.deliver();
    const call = (token: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/v1/internal/as-user',
        headers: { 'x-internal-token': token },
        payload: {
          telegramId: e.telegramId,
          method: 'POST',
          path: `/participations/${pe}/day-confirmation`,
          payload: { value: 'confirmed' },
        },
      });
    expect((await call('wrong')).statusCode).toBe(401);
    const ok = await call('test-internal-token');
    expect(ok.statusCode).toBe(200);
    expect((await pending(pe)).map((n) => n.kind)).not.toContain('unconfirmed_alert');
  });
});
