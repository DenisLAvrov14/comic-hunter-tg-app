// Анонсы событий в группах и каналах (SPEC §7.4). В группах web_app-кнопки не работают —
// кнопка ведёт на прямую ссылку Mini App t.me/<bot>/<app>?startapp=e_<id>.
import { and, eq, schema, sql, type Db } from '@standup/db';
import { ru } from '@standup/shared';
import { dateTime } from './format';
import { appLink, type LinkConfig } from './links';
import type { ChatPoster, OutgoingMessage } from './sender';

const { events, venues, users, organizerProfiles, participations, eventPosts, telegramChats } =
  schema;
const t = ru.post;

export async function renderEventPost(
  db: Db,
  eventId: string,
  links: LinkConfig,
): Promise<Omit<OutgoingMessage, 'chatId'> | null> {
  const [row] = await db
    .select({
      event: events,
      venue: venues,
      organizer: sql<string>`coalesce(${organizerProfiles.displayName}, ${users.firstName})`,
      accepted: sql<number>`(select count(*)::int from ${participations} p where p.event_id = ${events.id} and p.status = 'accepted')`,
    })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(users, eq(users.id, events.organizerId))
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, events.organizerId))
    .where(eq(events.id, eventId));
  if (!row) return null;
  const e = row.event;
  // Набор закрыт: состав заполнен, набор выключен или событие не принимает заявки.
  const status =
    e.status === 'cancelled'
      ? t.cancelled
      : e.status === 'recruiting' && e.recruitmentOpen && row.accepted < e.slotsCount
        ? t.open
        : t.closed;
  const text = [
    t.title(e.title),
    t.when(dateTime(e.startsAt, row.venue.timezone)),
    t.venue(row.venue.name, row.venue.address),
    t.format(ru.app.formats[e.format], e.slotsCount),
    t.organizer(row.organizer),
    ...(e.conditions.trim() ? [t.conditions(e.conditions.trim())] : []),
    '',
    status,
  ].join('\n');
  const url = appLink(links, `e_${e.id}`);
  const buttons =
    url && e.status !== 'cancelled'
      ? [[{ text: status === t.open ? t.apply : t.details, url }]]
      : [];
  return { text, buttons };
}

/** Публикует анонс в чаты организатора; уже опубликованный в чате — обновляет. */
export async function publishEventPosts(
  db: Db,
  poster: ChatPoster,
  links: LinkConfig,
  eventId: string,
  chats: Array<{ id: string; telegramChatId: number }>,
): Promise<{ published: string[]; failed: Array<{ chatId: string; error: string }> }> {
  const content = await renderEventPost(db, eventId, links);
  const published: string[] = [];
  const failed: Array<{ chatId: string; error: string }> = [];
  if (!content) return { published, failed };
  for (const chat of chats) {
    const [existing] = await db
      .select()
      .from(eventPosts)
      .where(and(eq(eventPosts.eventId, eventId), eq(eventPosts.chatId, chat.id)));
    if (existing) {
      const r = await poster.edit({
        ...content,
        chatId: chat.telegramChatId,
        messageId: existing.telegramMessageId,
      });
      if (r.status === 'ok') published.push(chat.id);
      else failed.push({ chatId: chat.id, error: r.error });
      continue;
    }
    const r = await poster.post({ ...content, chatId: chat.telegramChatId });
    if (r.status === 'ok') {
      await db
        .insert(eventPosts)
        .values({ eventId, chatId: chat.id, telegramMessageId: r.messageId });
      published.push(chat.id);
    } else {
      failed.push({ chatId: chat.id, error: r.error });
    }
  }
  return { published, failed };
}

/** После изменения события — обновить все его посты (ошибки не мешают основному действию). */
export async function refreshEventPosts(
  db: Db,
  poster: ChatPoster,
  links: LinkConfig,
  eventId: string,
) {
  const posts = await db
    .select({ chatId: telegramChats.id, telegramChatId: telegramChats.telegramChatId })
    .from(eventPosts)
    .innerJoin(telegramChats, eq(telegramChats.id, eventPosts.chatId))
    .where(eq(eventPosts.eventId, eventId));
  if (posts.length === 0) return { published: [], failed: [] };
  return publishEventPosts(
    db,
    poster,
    links,
    eventId,
    posts.map((p) => ({ id: p.chatId, telegramChatId: p.telegramChatId })),
  );
}
