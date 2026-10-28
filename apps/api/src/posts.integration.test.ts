import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray, schema, upsertTelegramChat } from '@standup/db';
import {
  TEST_DATABASE_URL,
  login,
  setupTestApp,
  telegramIdBase,
  type TestClient,
} from './test-helpers';

// Этап 8: анонсы событий в группах и каналах.
describe.skipIf(!TEST_DATABASE_URL)('Посты в чаты (Postgres)', () => {
  let ctx: Awaited<ReturnType<typeof setupTestApp>>;
  const base = telegramIdBase();
  const day = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
  const users: TestClient[] = [];
  const chatIds: string[] = [];
  let org: TestClient;
  let comic: TestClient;
  let venueId = '';

  beforeAll(async () => {
    ctx = await setupTestApp();
    org = await login(ctx.app, base, 'Орг');
    comic = await login(ctx.app, base + 1, 'Комик');
    const other = await login(ctx.app, base + 2, 'Другой');
    users.push(org, comic, other);
    const cities = (await org.call('GET', '/cities')).json() as Array<{ id: number; name: string }>;
    const moscow = cities.find((c) => c.name === 'Москва')!.id;
    await org.call('PUT', '/me/roles', { roles: ['organizer'] });
    await org.call('PUT', '/me/organizer-profile', { displayName: 'Ольга', cityId: moscow });
    venueId = (
      await org.call('POST', '/venues', {
        name: `Подвал ${base}`,
        address: 'ул. 1',
        cityId: moscow,
      })
    ).json().id;
    await comic.call('PUT', '/me/roles', { roles: ['comedian'] });
    await comic.call('PUT', '/me/comedian-profile', {
      stageName: `Комик ${base}`,
      cityId: moscow,
      contact: '@c',
    });
    // Как это сделал бы бот по my_chat_member.
    for (const [n, addedBy, botCanPost] of [
      [1, org.userId, true],
      [2, other.userId, true],
      [3, org.userId, false],
    ] as const) {
      const chat = await upsertTelegramChat(ctx.db, {
        telegramChatId: -(base * 10 + n),
        title: `Чат ${n} ${base}`,
        type: 'supergroup',
        addedBy,
        botCanPost,
      });
      chatIds.push(chat.id);
    }
  });

  afterAll(async () => {
    if (!ctx) return;
    const ids = users.map((u) => u.userId);
    await ctx.db.delete(schema.events).where(inArray(schema.events.organizerId, ids));
    await ctx.db.delete(schema.telegramChats).where(inArray(schema.telegramChats.id, chatIds));
    await ctx.db.delete(schema.venues).where(inArray(schema.venues.id, [venueId]));
    await ctx.db.delete(schema.users).where(inArray(schema.users.id, ids));
    await ctx.close();
  });

  it('анонс в свой чат с прямой ссылкой; обновляется при изменениях; «Набор закрыт»', async () => {
    const chats = (await org.call('GET', '/me/chats')).json();
    expect(chats.map((c: { id: string }) => c.id).sort()).toEqual([chatIds[0], chatIds[2]].sort());

    const eventId = (
      await org.call('POST', '/events', {
        venueId,
        title: `Open mic ${base}`,
        format: 'open_mic',
        startsAtLocal: `${day}T20:00`,
        slotsCount: 1,
        setMinutes: 10,
        recruitmentOpen: true,
        conditions: 'Вход свободный',
      })
    ).json().id;

    // Публикуем во все три: чужой чат и чат без прав пропускаются.
    const res = await org.call('POST', `/events/${eventId}/posts`, { chatIds });
    expect(res.statusCode).toBe(200);
    expect(res.json().published).toEqual([chatIds[0]]);
    const post = ctx.poster.posts.at(-1)!;
    expect(post.chatId).toBe(-(base * 10 + 1));
    expect(post.text).toContain(`🎤 Open mic ${base}`);
    expect(post.text).toContain('Набор открыт');
    expect(post.text).toContain('Условия: Вход свободный');
    // В группах web_app-кнопки не работают — URL-кнопка на прямую ссылку Mini App.
    expect(post.buttons).toEqual([
      [{ text: 'Записаться', url: `https://t.me/standup_bot/app?startapp=e_${eventId}` }],
    ]);

    // Комик пришёл по кнопке → карточка события → «Подать заявку».
    const details = await comic.call('GET', `/events/${eventId}`);
    expect(details.json().viewer.canApply).toBe(true);
    const application = (await comic.call('POST', `/events/${eventId}/applications`, {})).json();

    // Организатор принял — состав заполнен, пост помечен «Набор закрыт».
    await org.call('POST', `/participations/${application.id}/actions`, { action: 'accept' });
    const edit = ctx.poster.edits.at(-1)!;
    expect(edit.messageId).toBe(post.messageId);
    expect(edit.text).toContain('Набор закрыт');
    expect(edit.buttons![0]![0]!.text).toBe('Подробнее');

    // Изменение события — пост обновляется, а не дублируется.
    await org.call('PATCH', `/events/${eventId}`, { title: `Новое название ${base}` });
    expect(ctx.poster.edits.at(-1)!.text).toContain(`Новое название ${base}`);
    await org.call('POST', `/events/${eventId}/posts`, { chatIds: [chatIds[0]] });
    expect(ctx.poster.posts.filter((p) => p.chatId === post.chatId)).toHaveLength(1);
    expect((await org.call('GET', `/events/${eventId}/posts`)).json()).toHaveLength(1);

    // Отмена — «Событие отменено», без кнопки записи.
    await org.call('POST', `/events/${eventId}/cancel`);
    const cancelled = ctx.poster.edits.at(-1)!;
    expect(cancelled.text).toContain('Событие отменено');
    expect(cancelled.buttons).toEqual([]);
  });

  it('публиковать может только организатор события', async () => {
    const eventId = (
      await org.call('POST', '/events', {
        venueId,
        title: `Чужое ${base}`,
        format: 'other',
        startsAtLocal: `${day}T18:00`,
        slotsCount: 2,
        setMinutes: 5,
        recruitmentOpen: true,
      })
    ).json().id;
    expect(
      (await comic.call('POST', `/events/${eventId}/posts`, { chatIds: [chatIds[0]] })).statusCode,
    ).toBe(404);
    // Только в чаты без прав — ошибка валидации.
    expect(
      (await org.call('POST', `/events/${eventId}/posts`, { chatIds: [chatIds[2]] })).statusCode,
    ).toBe(400);
  });
});
