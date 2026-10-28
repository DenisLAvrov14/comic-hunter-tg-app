import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray, schema, type Db } from '@standup/db';
import { localToUtc } from '@standup/domain';
import {
  TEST_DATABASE_URL,
  login,
  setupTestApp,
  telegramIdBase,
  type TestClient,
} from './test-helpers';

// Этап 4: события и три способа набора против реального Postgres.
describe.skipIf(!TEST_DATABASE_URL)('API события и набор (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  let db: Db;
  const base = telegramIdBase();
  const day = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  let moscowId = 0;
  let venueId = '';
  let venue2Id = '';

  let org: TestClient;
  let a: TestClient;
  let b: TestClient;
  let c: TestClient;
  let d: TestClient;
  let outsider: TestClient;
  const all = () => [org, a, b, c, d, outsider];

  async function comedian(n: number, name: string) {
    const u = await login(ctx.app, base + n, name);
    await u.call('PUT', '/me/roles', { roles: ['comedian'] });
    const res = await u.call('PUT', '/me/comedian-profile', {
      stageName: `${name} ${base}`,
      cityId: moscowId,
      contact: '@x',
    });
    expect(res.statusCode).toBe(200);
    return u;
  }

  async function createEvent(patch: object = {}) {
    const res = await org.call('POST', '/events', {
      venueId,
      title: `Open Mic ${base}`,
      format: 'open_mic',
      startsAtLocal: `${day}T20:00`,
      slotsCount: 3,
      setMinutes: 10,
      gapMinutes: 2,
      recruitmentOpen: true,
      ...patch,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  }

  const act = (u: TestClient, participationId: string, action: string, payload?: object) =>
    u.call('POST', `/participations/${participationId}/actions`, { action, payload });

  async function lineup(eventId: string) {
    const res = await org.call('GET', `/events/${eventId}/lineup`);
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  beforeAll(async () => {
    ctx = await setupTestApp();
    db = ctx.db;
    org = await login(ctx.app, base, 'Орг');
    const cities = (await org.call('GET', '/cities')).json() as Array<{ id: number; name: string }>;
    moscowId = cities.find((x) => x.name === 'Москва')!.id;
    await org.call('PUT', '/me/roles', { roles: ['organizer'] });
    await org.call('PUT', '/me/organizer-profile', { displayName: 'Орг', cityId: moscowId });
    venueId = (
      await org.call('POST', '/venues', {
        name: `Подвал ${base}`,
        address: 'ул. 1',
        cityId: moscowId,
      })
    ).json().id;
    venue2Id = (
      await org.call('POST', '/venues', { name: `Бар ${base}`, address: 'ул. 2', cityId: moscowId })
    ).json().id;
    a = await comedian(1, 'Аня');
    b = await comedian(2, 'Боря');
    c = await comedian(3, 'Вера');
    d = await comedian(4, 'Гоша');
    outsider = await comedian(5, 'Чужой');
  });

  afterAll(async () => {
    if (!db) return;
    const ids = all()
      .filter(Boolean)
      .map((u) => u.userId);
    await db.delete(schema.events).where(inArray(schema.events.organizerId, ids));
    await db.delete(schema.venues).where(inArray(schema.venues.id, [venueId, venue2Id]));
    await db.delete(schema.users).where(inArray(schema.users.id, ids));
    await ctx.close();
  });

  it('создание: местное время площадки → UTC, окно по слотам, токен ссылки', async () => {
    const e = await createEvent();
    expect(e.startsAt).toBe(localToUtc(`${day}T20:00`, 'Europe/Moscow').toISOString());
    expect(e.timezone).toBe('Europe/Moscow');
    // 3 × (10 + 2) = 36 минут.
    expect(new Date(e.windowEndsAt).getTime() - new Date(e.startsAt).getTime()).toBe(36 * 60_000);
    expect(e.linkToken).toMatch(/^[\w-]{20,}$/);
    expect(e.viewer).toMatchObject({ isOrganizer: true, canApply: false });
  });

  it('комик без роли организатора не создаёт событие', async () => {
    const res = await a.call('POST', '/events', {
      venueId,
      title: 'X',
      format: 'other',
      startsAtLocal: `${day}T20:00`,
      slotsCount: 1,
      setMinutes: 5,
    });
    expect(res.statusCode).toBe(403);
  });

  it('три способа набора, входящие, состав и пересечения', async () => {
    const e1 = await createEvent();

    // 1. Открытый набор: событие в «Ищут комиков», заявка.
    const open = (await a.call('GET', `/events?city=${moscowId}`)).json() as Array<{ id: string }>;
    expect(open.map((x) => x.id)).toContain(e1.id);
    const app1 = await a.call('POST', `/events/${e1.id}/applications`, { message: 'Хочу!' });
    expect(app1.statusCode).toBe(201);
    expect(app1.json()).toMatchObject({ status: 'pending', source: 'application' });
    expect((await a.call('POST', `/events/${e1.id}/applications`, {})).statusCode).toBe(409);

    const inboxA = (await a.call('GET', '/me/inbox')).json();
    expect(inboxA.applications.map((i: { event: { id: string } }) => i.event.id)).toContain(e1.id);

    // 2. По ссылке: закрытый набор виден только по токену.
    const closed = await createEvent({ recruitmentOpen: false, title: `Закрытый ${base}` });
    expect((await outsider.call('GET', `/events/${closed.id}`)).statusCode).toBe(404);
    const byLink = await outsider.call('GET', `/events/by-link/${closed.linkToken}`);
    expect(byLink.statusCode).toBe(200);
    expect(byLink.json().viewer.canApply).toBe(true);
    expect((await outsider.call('POST', `/events/${closed.id}/applications`, {})).statusCode).toBe(
      404,
    );
    const viaLink = await outsider.call('POST', `/events/${closed.id}/applications`, {
      token: closed.linkToken,
    });
    expect(viaLink.json()).toMatchObject({ status: 'pending', source: 'link' });

    // Перевыпуск токена — старая ссылка больше не работает.
    const rotated = (await org.call('POST', `/events/${closed.id}/link/rotate`)).json();
    expect(rotated.linkToken).not.toBe(closed.linkToken);
    expect((await d.call('GET', `/events/by-link/${closed.linkToken}`)).statusCode).toBe(404);

    // 3. Приглашения: повторно активного не приглашаем.
    const inv = (
      await org.call('POST', `/events/${e1.id}/invitations`, {
        comedianIds: [b.userId, c.userId, a.userId],
      })
    ).json();
    expect(inv.invited.sort()).toEqual([b.userId, c.userId].sort());
    expect(inv.skipped).toEqual([a.userId]);

    const inboxB = (await b.call('GET', '/me/inbox')).json();
    const invB = inboxB.invitations.find((i: { event: { id: string } }) => i.event.id === e1.id);
    expect(invB.participation.status).toBe('invited');

    // Комик принимает приглашение → позиция 1.
    const accB = await act(b, invB.participation.id, 'accept');
    expect(accB.json()).toMatchObject({ status: 'accepted', position: 1 });

    // Организатор принимает заявку → позиция 2.
    let l = await lineup(e1.id);
    const appA = l.applications[0];
    expect(appA.comedian.id).toBe(a.userId);
    expect(appA.message).toBe('Хочу!');
    expect((await act(org, appA.id, 'accept')).json()).toMatchObject({ position: 2 });

    l = await lineup(e1.id);
    expect(l.accepted.map((x: { comedian: { id: string } }) => x.comedian.id)).toEqual([
      b.userId,
      a.userId,
    ]);
    // Второй выходит через 10 + 2 минут после начала.
    expect(new Date(l.accepted[1].stageStart).getTime() - new Date(e1.startsAt).getTime()).toBe(
      12 * 60_000,
    );

    // Пересечение: другое событие в 20:20 в соседнем баре, Аня уже выступает в 20:12–20:22.
    const e3 = await createEvent({
      venueId: venue2Id,
      startsAtLocal: `${day}T20:20`,
      title: `Бар ${base}`,
    });
    await a.call('POST', `/events/${e3.id}/applications`, {});
    const l3 = await lineup(e3.id);
    expect(l3.applications[0].conflicts[0]).toMatchObject({
      kind: 'gig',
      title: `Open Mic ${base}`,
      venue: `Подвал ${base}`,
    });
    const conflict = await act(org, l3.applications[0].id, 'accept');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('CONFLICT_SCHEDULE');
    expect(conflict.json().error.details.conflicts).toHaveLength(1);
    // Организатор принимает вопреки предупреждению.
    const forced = await act(org, l3.applications[0].id, 'accept', { force: true });
    expect(forced.json()).toMatchObject({ status: 'accepted', position: 1 });

    // Заполненный состав: третий принят, четвёртому — только резерв.
    const invC = (await lineup(e1.id)).invitations.find(
      (x: { comedian: { id: string } }) => x.comedian.id === c.userId,
    );
    expect((await act(c, invC.id, 'accept')).json()).toMatchObject({ position: 3 });
    await d.call('POST', `/events/${e1.id}/applications`, {});
    const appD = (await lineup(e1.id)).applications[0];
    const full = await act(org, appD.id, 'accept');
    expect(full.json().error.code).toBe('LINEUP_FULL');
    expect((await act(org, appD.id, 'reserve')).json().status).toBe('reserve');

    // Уменьшить число мест ниже состава нельзя.
    expect((await org.call('PATCH', `/events/${e1.id}`, { slotsCount: 2 })).statusCode).toBe(400);

    // Отказ участника уплотняет позиции и меняет версию состава.
    const before = (await lineup(e1.id)).version;
    expect((await act(b, accB.json().id, 'withdraw')).json().status).toBe('withdrawn');
    l = await lineup(e1.id);
    expect(l.version).toBeGreaterThan(before);
    expect(l.accepted.map((x: { position: number }) => x.position)).toEqual([1, 2]);
    expect(l.accepted[0].comedian.id).toBe(a.userId);

    // Резервист повышается на освободившееся место.
    expect((await act(org, appD.id, 'promote')).json()).toMatchObject({
      status: 'accepted',
      position: 3,
    });

    // Права: чужой комик не управляет участием, организатор не отвечает за комика.
    expect((await act(c, appD.id, 'remove')).statusCode).toBe(404);
    expect((await act(org, appD.id, 'decline')).json().error.code).toBe('INVALID_TRANSITION');
    // Полный состав с заявками видит только организатор.
    expect((await a.call('GET', `/events/${e1.id}/lineup`)).statusCode).toBe(404);
    // Комикам виден порядок выхода (showLineup по умолчанию).
    const seen = (await outsider.call('GET', `/events/${e1.id}`)).json();
    expect(seen.lineup.map((x: { position: number }) => x.position)).toEqual([1, 2, 3]);
  });

  it('встречное предложение: комик предлагает, организатор отклоняет', async () => {
    const e = await createEvent();
    await org.call('POST', `/events/${e.id}/invitations`, { comedianIds: [d.userId] });
    const p = (await lineup(e.id)).invitations[0];
    expect((await act(d, p.id, 'counter_propose')).statusCode).toBe(400);
    const cp = await act(d, p.id, 'counter_propose', { text: 'Могу после 21:00' });
    expect(cp.json()).toMatchObject({
      status: 'counter_proposed',
      counterProposal: 'Могу после 21:00',
    });
    expect((await act(org, p.id, 'reject')).json().status).toBe('declined');
    // История переходов пишется на каждый шаг.
    const history = await db
      .select()
      .from(schema.participationEvents)
      .where(eq(schema.participationEvents.participationId, p.id));
    expect(history.map((h) => h.toStatus)).toEqual(['invited', 'counter_proposed', 'declined']);
  });

  it('гонка: два приглашения на одно время приняты параллельно → принято одно', async () => {
    const racer = await comedian(6, 'Гонщик');
    const e4 = await createEvent({ startsAtLocal: `${day}T22:00` });
    const e5 = await createEvent({ venueId: venue2Id, startsAtLocal: `${day}T22:00` });
    await org.call('POST', `/events/${e4.id}/invitations`, { comedianIds: [racer.userId] });
    await org.call('POST', `/events/${e5.id}/invitations`, { comedianIds: [racer.userId] });
    const inbox = (await racer.call('GET', '/me/inbox')).json();
    const ids = inbox.invitations.map((i: { participation: { id: string } }) => i.participation.id);
    expect(ids).toHaveLength(2);
    const results = await Promise.all(ids.map((id: string) => act(racer, id, 'accept')));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    await db.delete(schema.users).where(eq(schema.users.id, racer.userId));
  });

  it('поиск комиков: по имени и «свободен в это время»', async () => {
    const e = await createEvent({ startsAtLocal: `${day}T20:05` });
    const byName = (
      await org.call('GET', `/comedians?q=${encodeURIComponent(`Вера ${base}`)}`)
    ).json();
    expect(byName.map((x: { id: string }) => x.id)).toEqual([c.userId]);

    const free = (await org.call('GET', `/comedians?city=${moscowId}&freeAtEvent=${e.id}`)).json();
    const freeIds = free.map((x: { id: string }) => x.id);
    // Аня, Вера и Гоша в составе соседнего события в 20:00 — заняты; Боря отказался — свободен.
    expect(freeIds).toContain(b.userId);
    expect(freeIds).not.toContain(a.userId);
    expect(freeIds).not.toContain(c.userId);

    const card = (await org.call('GET', `/comedians/${c.userId}`)).json();
    expect(card).toMatchObject({ id: c.userId, gigsCount: 0, category: 'newbie' });
    expect((await a.call('GET', '/comedians')).statusCode).toBe(403);
  });

  it('копия события — черновик через неделю в то же местное время; отмена', async () => {
    const e = await createEvent();
    const copy = (await org.call('POST', `/events/${e.id}/duplicate`)).json();
    expect(copy.status).toBe('draft');
    expect(new Date(copy.startsAt).getTime() - new Date(e.startsAt).getTime()).toBe(7 * 86_400_000);
    expect(copy.linkToken).not.toBe(e.linkToken);
    // Черновик комикам не виден.
    expect((await a.call('GET', `/events/${copy.id}`)).statusCode).toBe(404);

    const cancelled = (await org.call('POST', `/events/${e.id}/cancel`)).json();
    expect(cancelled.status).toBe('cancelled');
    expect((await a.call('POST', `/events/${e.id}/applications`, {})).statusCode).toBe(409);
    expect((await a.call('POST', `/events/${e.id}/cancel`)).statusCode).toBe(403);
  });
});
