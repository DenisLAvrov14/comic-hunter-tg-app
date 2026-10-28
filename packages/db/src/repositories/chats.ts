import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { eventPosts, telegramChats, type TelegramChat } from '../schema';
import type { DbOrTx } from './events';

/** Бот добавлен в чат или его права изменились (my_chat_member). */
export async function upsertTelegramChat(
  db: DbOrTx,
  data: {
    telegramChatId: number;
    title: string;
    type: string;
    addedBy: string | null;
    botCanPost: boolean;
  },
): Promise<TelegramChat> {
  const [row] = await db
    .insert(telegramChats)
    .values(data)
    .onConflictDoUpdate({
      target: telegramChats.telegramChatId,
      set: {
        title: data.title,
        type: data.type,
        botCanPost: data.botCanPost,
        // Кто добавил — запоминаем первого; повторное добавление другим пользователем переназначает.
        ...(data.addedBy ? { addedBy: data.addedBy } : {}),
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return row!;
}

/** Чаты, куда пользователь добавил бота. */
export function listUserChats(db: DbOrTx, userId: string): Promise<TelegramChat[]> {
  return db
    .select()
    .from(telegramChats)
    .where(eq(telegramChats.addedBy, userId))
    .orderBy(asc(telegramChats.title));
}

export function listEventPosts(db: DbOrTx, eventId: string) {
  return db
    .select({ post: eventPosts, chat: telegramChats })
    .from(eventPosts)
    .innerJoin(telegramChats, eq(telegramChats.id, eventPosts.chatId))
    .where(eq(eventPosts.eventId, eventId));
}

export async function saveEventPost(
  db: Db,
  data: { eventId: string; chatId: string; telegramMessageId: number },
) {
  await db
    .insert(eventPosts)
    .values(data)
    .onConflictDoUpdate({
      target: [eventPosts.eventId, eventPosts.chatId],
      set: { telegramMessageId: data.telegramMessageId },
    });
}

export async function deleteEventPost(db: Db, eventId: string, chatId: string) {
  await db
    .delete(eventPosts)
    .where(and(eq(eventPosts.eventId, eventId), eq(eventPosts.chatId, chatId)));
}
