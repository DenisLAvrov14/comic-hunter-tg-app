// Чат события в Telegram: кто может в него вступить и кому слать приглашение.
// Ссылка — с заявкой на вступление; бот одобряет её только участникам события.
import { and, eq, inArray, schema, type DbOrTx } from '@standup/db';
import { CHAT_PARTICIPATION_STATUSES } from '@standup/domain';

const { scheduledNotifications: sn, participations, eventStaff, events, telegramChats } = schema;

/** Кому слать приглашение при подключении чата: состав и ведущие (без самого организатора). */
export async function eventChatInvitees(db: DbOrTx, eventId: string): Promise<string[]> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) return [];
  const [lineup, staff] = await Promise.all([
    db
      .select({ userId: participations.comedianId })
      .from(participations)
      .where(and(eq(participations.eventId, eventId), eq(participations.status, 'accepted'))),
    db
      .select({ userId: eventStaff.userId })
      .from(eventStaff)
      .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.status, 'accepted'))),
  ]);
  const ids = new Set([...lineup, ...staff].map((r) => r.userId));
  ids.delete(event.organizerId);
  return [...ids];
}

/**
 * Приглашения в чат события — по одному на человека и событие: повторное принятие в состав
 * второе сообщение не шлёт. Без подключённого чата ничего не делает.
 */
export async function inviteToEventChat(db: DbOrTx, eventId: string, userIds: string[], now: Date) {
  if (userIds.length === 0) return;
  const [event] = await db
    .select({ chatInviteLink: events.chatInviteLink, chatId: events.chatId })
    .from(events)
    .where(eq(events.id, eventId));
  if (!event?.chatInviteLink || !event.chatId) return;
  for (const userId of userIds) {
    await db
      .insert(sn)
      .values({
        userId,
        kind: 'event_chat_invite',
        eventId,
        sendAt: now,
        // Чат сменили — по новой ссылке пригласить ещё раз.
        dedupeKey: `event_chat_invite:${userId}:${eventId}:${event.chatId}`,
      })
      .onConflictDoNothing({ target: sn.dedupeKey });
  }
}

/** Пускать ли пользователя в чат: он участник (или штат) хотя бы одного события с этим чатом. */
export async function mayJoinEventChat(
  db: DbOrTx,
  telegramChatId: number,
  userId: string,
): Promise<boolean> {
  const linked = await db
    .select({ id: events.id, organizerId: events.organizerId })
    .from(events)
    .innerJoin(telegramChats, eq(telegramChats.id, events.chatId))
    .where(eq(telegramChats.telegramChatId, telegramChatId));
  if (linked.length === 0) return false;
  if (linked.some((e) => e.organizerId === userId)) return true;
  const ids = linked.map((e) => e.id);
  const [p] = await db
    .select({ id: participations.id })
    .from(participations)
    .where(
      and(
        inArray(participations.eventId, ids),
        eq(participations.comedianId, userId),
        inArray(participations.status, [...CHAT_PARTICIPATION_STATUSES]),
      ),
    )
    .limit(1);
  if (p) return true;
  const [s] = await db
    .select({ userId: eventStaff.userId })
    .from(eventStaff)
    .where(
      and(
        inArray(eventStaff.eventId, ids),
        eq(eventStaff.userId, userId),
        eq(eventStaff.status, 'accepted'),
      ),
    )
    .limit(1);
  return !!s;
}
