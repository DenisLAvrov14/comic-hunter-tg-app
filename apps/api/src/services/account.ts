import {
  anonymizeUser,
  listFutureOrganizedEvents,
  listFutureParticipations,
  updateEvent,
  type Db,
} from '@standup/db';
import { activeStatuses } from '@standup/domain';
import { notifyEventParticipants } from '@standup/notify';
import { ru } from '@standup/shared';
import type { FileStorage } from '../storage';
import { applyParticipationAction } from './participations';

export interface DeleteAccountResult {
  /** События, где поменялся состав или статус, — для обновления анонсов в чатах. */
  changedEvents: string[];
}

/**
 * DELETE /me (SPEC §11): комик снимается со всех будущих выступлений (организаторы получают
 * обычные уведомления), будущие события организатора отменяются, затем персональные данные
 * стираются. Прошедшие составы остаются с «Удалённым пользователем».
 */
export async function deleteAccount(
  db: Db,
  storage: FileStorage,
  userId: string,
  now: Date = new Date(),
): Promise<DeleteAccountResult> {
  // Через обычное действие withdraw — с блокировками, уплотнением позиций и уведомлениями.
  const mine = await listFutureParticipations(db, userId, activeStatuses, now);
  for (const p of mine) {
    await applyParticipationAction(db, userId, p.id, { action: 'withdraw' });
  }

  const cancelled: string[] = [];
  const photoKeys = await db.transaction(async (tx) => {
    const organized = await listFutureOrganizedEvents(tx, userId, now);
    for (const event of organized) {
      await updateEvent(tx, event.id, { status: 'cancelled' });
      await notifyEventParticipants(tx, event, 'event_cancelled', now);
    }
    cancelled.push(...organized.map((e) => e.id));
    return anonymizeUser(tx, userId, ru.app.account.deletedName, now);
  });

  if (photoKeys.length > 0) {
    // Данные в БД уже стёрты; не удалившиеся файлы без ссылок на них не мешают ответу.
    await storage.delete(photoKeys).catch(() => undefined);
  }
  return { changedEvents: [...new Set([...mine.map((p) => p.eventId), ...cancelled])] };
}
