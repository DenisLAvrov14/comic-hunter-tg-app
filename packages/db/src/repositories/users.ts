import { eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { userRoles, users, type User } from '../schema';

export interface TelegramUserInput {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

/** Создаёт пользователя или обновляет его данные из Telegram. */
export async function upsertTelegramUser(
  db: Db,
  tg: TelegramUserInput,
  opts: { botStarted?: boolean } = {},
): Promise<User> {
  const fromTelegram = {
    telegramUsername: tg.username ?? null,
    firstName: tg.first_name,
    lastName: tg.last_name ?? null,
    languageCode: tg.language_code ?? null,
  };
  // /start в боте означает, что пользователь снова может получать сообщения.
  const botFlags = opts.botStarted ? { botStarted: true, botBlocked: false } : {};
  const [row] = await db
    .insert(users)
    .values({ telegramId: tg.id, ...fromTelegram, ...botFlags })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: { ...fromTelegram, ...botFlags, updatedAt: sql`now()` },
    })
    .returning();
  return row!;
}

export async function findUserById(db: Db, id: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id));
  return row;
}

export async function findUserByTelegramId(db: Db, telegramId: number): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.telegramId, telegramId));
  return row;
}

export async function getUserRoles(db: Db, userId: string) {
  const rows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId));
  return rows.map((r) => r.role);
}
