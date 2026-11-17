import { randomInt } from 'node:crypto';
import { and, eq, gt, inArray, notInArray, or } from 'drizzle-orm';
import type { DbOrTx, Tx } from './events';
import {
  autoAcceptRules,
  busySlots,
  calendarFeeds,
  comedianPhotos,
  comedianProfiles,
  comedianTrips,
  eventStaff,
  events,
  organizerProfiles,
  participations,
  scheduledNotifications,
  telegramChats,
  userRoles,
  users,
  type Participation,
} from '../schema';

type ParticipationStatus = Participation['status'];

/** Участия комика в событиях, которые ещё не начались и не отменены. */
export async function listFutureParticipations(
  db: DbOrTx,
  userId: string,
  statuses: readonly ParticipationStatus[],
  now: Date,
) {
  return db
    .select({ id: participations.id, eventId: participations.eventId })
    .from(participations)
    .innerJoin(events, eq(events.id, participations.eventId))
    .where(
      and(
        eq(participations.comedianId, userId),
        inArray(participations.status, [...statuses]),
        gt(events.startsAt, now),
        notInArray(events.status, ['cancelled', 'finished']),
      ),
    );
}

/** События организатора, которые ещё не начались и не отменены. */
export async function listFutureOrganizedEvents(db: DbOrTx, userId: string, now: Date) {
  return db
    .select()
    .from(events)
    .where(
      and(
        eq(events.organizerId, userId),
        gt(events.startsAt, now),
        notInArray(events.status, ['cancelled', 'finished']),
      ),
    );
}

/**
 * Стирает персональные данные пользователя (SPEC §11, DELETE /me). Строка users и история
 * участий остаются, чтобы прошедшие составы и события не ломались, но связи с Telegram,
 * имени, контактов и фото больше нет. Возвращает ключи файлов в S3 для удаления.
 */
export async function anonymizeUser(
  tx: Tx,
  userId: string,
  placeholderName: string,
  now: Date,
): Promise<string[]> {
  const photos = await tx
    .select({ s3Key: comedianPhotos.s3Key, previewS3Key: comedianPhotos.previewS3Key })
    .from(comedianPhotos)
    .where(eq(comedianPhotos.userId, userId));
  await tx.delete(comedianPhotos).where(eq(comedianPhotos.userId, userId));

  await tx
    .update(comedianProfiles)
    .set({
      stageName: placeholderName,
      bio: null,
      contact: '',
      links: [],
      isSearchable: false,
      updatedAt: now,
    })
    .where(eq(comedianProfiles.userId, userId));
  await tx
    .update(organizerProfiles)
    .set({ displayName: placeholderName, projectName: null, contact: null, updatedAt: now })
    .where(eq(organizerProfiles.userId, userId));

  await tx.delete(userRoles).where(eq(userRoles.userId, userId));
  await tx.delete(busySlots).where(eq(busySlots.userId, userId));
  await tx.delete(comedianTrips).where(eq(comedianTrips.comedianId, userId));
  await tx
    .delete(autoAcceptRules)
    .where(or(eq(autoAcceptRules.comedianId, userId), eq(autoAcceptRules.organizerId, userId)));
  await tx.delete(calendarFeeds).where(eq(calendarFeeds.userId, userId));
  await tx.delete(eventStaff).where(eq(eventStaff.userId, userId));
  await tx.delete(scheduledNotifications).where(eq(scheduledNotifications.userId, userId));
  await tx.update(telegramChats).set({ addedBy: null }).where(eq(telegramChats.addedBy, userId));

  await tx
    .update(users)
    .set({
      // telegram_id обязателен и уникален: отрицательный id не совпадёт ни с одним из Telegram,
      // и повторный вход того же человека создаст нового пользователя.
      telegramId: -randomInt(1, 2 ** 47),
      telegramUsername: null,
      firstName: placeholderName,
      lastName: null,
      languageCode: null,
      botStarted: false,
      botBlocked: true,
      isAdmin: false,
      canManageAdmins: false,
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(users.id, userId));

  return photos.flatMap((p) => [p.s3Key, p.previewS3Key]);
}
