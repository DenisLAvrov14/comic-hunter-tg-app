import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client';
import {
  autoAcceptRules,
  busySlots,
  calendarFeeds,
  events,
  organizerProfiles,
  participationEvents,
  participations,
  userRoles,
  users,
  venues,
  type AutoAcceptRuleRow,
  type BusySlot,
} from '../schema';
import { likePattern, type DbOrTx } from './events';

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

// --- Календарь комика ---

/** Принятые выступления комика, чьё окно пересекает [from, to). */
export function listCalendarGigs(db: DbOrTx, userId: string, from: Date, to: Date) {
  return db
    .select({ participation: participations, event: events, venue: venues })
    .from(participations)
    .innerJoin(events, eq(events.id, participations.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(
      and(
        eq(participations.comedianId, userId),
        eq(participations.status, 'accepted'),
        sql`${events.status} not in ('cancelled', 'draft')`,
        sql`tstzrange(${events.startsAt}, ${events.windowEndsAt}) && tstzrange(${ts(from)}, ${ts(to)})`,
      ),
    )
    .orderBy(asc(events.startsAt));
}

export async function createBusySlot(
  db: DbOrTx,
  data: Omit<typeof busySlots.$inferInsert, 'id' | 'createdAt'>,
): Promise<BusySlot> {
  const [row] = await db.insert(busySlots).values(data).returning();
  return row!;
}

export async function deleteBusySlot(db: DbOrTx, id: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(busySlots)
    .where(and(eq(busySlots.id, id), eq(busySlots.userId, userId)))
    .returning({ id: busySlots.id });
  return rows.length > 0;
}

// --- Правила автопринятия ---

const organizerName = sql<string>`coalesce(${organizerProfiles.displayName}, ${users.firstName})`;

export function listAutoAcceptRules(db: DbOrTx, comedianId: string) {
  return db
    .select({ rule: autoAcceptRules, organizerName, projectName: organizerProfiles.projectName })
    .from(autoAcceptRules)
    .innerJoin(users, eq(users.id, autoAcceptRules.organizerId))
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, autoAcceptRules.organizerId))
    .where(eq(autoAcceptRules.comedianId, comedianId))
    .orderBy(asc(organizerName));
}

export async function upsertAutoAcceptRule(
  db: DbOrTx,
  data: Omit<typeof autoAcceptRules.$inferInsert, 'id' | 'createdAt'>,
): Promise<AutoAcceptRuleRow> {
  const [row] = await db
    .insert(autoAcceptRules)
    .values(data)
    .onConflictDoUpdate({
      target: [autoAcceptRules.comedianId, autoAcceptRules.organizerId],
      set: {
        enabled: data.enabled,
        formats: data.formats,
        weekdays: data.weekdays,
        timeFrom: data.timeFrom,
        timeTo: data.timeTo,
        maxGigsPerDay: data.maxGigsPerDay,
      },
    })
    .returning();
  return row!;
}

export async function deleteAutoAcceptRule(db: DbOrTx, comedianId: string, organizerId: string) {
  await db
    .delete(autoAcceptRules)
    .where(
      and(eq(autoAcceptRules.comedianId, comedianId), eq(autoAcceptRules.organizerId, organizerId)),
    );
}

export async function findAutoAcceptRule(
  db: DbOrTx,
  comedianId: string,
  organizerId: string,
): Promise<AutoAcceptRuleRow | undefined> {
  const [row] = await db
    .select()
    .from(autoAcceptRules)
    .where(
      and(eq(autoAcceptRules.comedianId, comedianId), eq(autoAcceptRules.organizerId, organizerId)),
    );
  return row;
}

/** Организаторы для правил: по имени или названию проекта. */
export function searchOrganizers(db: DbOrTx, text: string | undefined, limit = 30) {
  const pattern = text ? likePattern(text) : null;
  return db
    .select({ userId: users.id, name: organizerName, projectName: organizerProfiles.projectName })
    .from(users)
    .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, 'organizer')))
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, users.id))
    .where(
      pattern
        ? sql`(${organizerName} ilike ${pattern} or ${organizerProfiles.projectName} ilike ${pattern})`
        : undefined,
    )
    .orderBy(asc(organizerName))
    .limit(limit);
}

// --- Подписка на календарь (ICS) ---

export async function findActiveFeed(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(calendarFeeds)
    .where(and(eq(calendarFeeds.userId, userId), isNull(calendarFeeds.revokedAt)));
  return row;
}

/** Создаёт ленту или выдаёт новый токен (старая ссылка перестаёт работать). */
export async function putFeedToken(db: Db, userId: string, token: string) {
  const [row] = await db
    .insert(calendarFeeds)
    .values({ userId, token })
    .onConflictDoUpdate({
      target: calendarFeeds.userId,
      set: { token, createdAt: sql`now()`, revokedAt: null },
    })
    .returning();
  return row!;
}

export async function findUserByFeedToken(db: Db, token: string) {
  const [row] = await db
    .select({ user: users })
    .from(calendarFeeds)
    .innerJoin(users, eq(users.id, calendarFeeds.userId))
    .where(and(eq(calendarFeeds.token, token), isNull(calendarFeeds.revokedAt)));
  return row?.user;
}

/**
 * Для ICS: текущие выступления и снятые/отменённые за последние `cancelledDays` дней,
 * если участие когда-то было принято (такие показываются со STATUS:CANCELLED).
 */
export async function listFeedGigs(db: Db, userId: string, since: Date, cancelledSince: Date) {
  const rows = await db
    .select({ participation: participations, event: events, venue: venues })
    .from(participations)
    .innerJoin(events, eq(events.id, participations.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(
      and(
        eq(participations.comedianId, userId),
        sql`${events.status} <> 'draft'`,
        sql`${events.windowEndsAt} >= ${ts(since)}`,
      ),
    )
    .orderBy(asc(events.startsAt));
  const candidates = rows.filter(
    (r) => r.participation.status !== 'accepted' || r.event.status === 'cancelled',
  );
  const everAccepted = new Set(
    candidates.length === 0
      ? []
      : (
          await db
            .select({ id: participationEvents.participationId })
            .from(participationEvents)
            .where(
              and(
                inArray(
                  participationEvents.participationId,
                  candidates.map((c) => c.participation.id),
                ),
                eq(participationEvents.toStatus, 'accepted'),
              ),
            )
        ).map((r) => r.id),
  );
  return rows
    .map((r) => {
      const cancelled = r.participation.status !== 'accepted' || r.event.status === 'cancelled';
      return { ...r, cancelled };
    })
    .filter(
      (r) =>
        !r.cancelled ||
        // Снят с участия или событие отменено — по последнему изменению того или другого.
        (everAccepted.has(r.participation.id) &&
          Math.max(r.participation.updatedAt.getTime(), r.event.updatedAt.getTime()) >=
            cancelledSince.getTime()),
    );
}

export function listManualGigs(db: Db, userId: string, since: Date) {
  return db
    .select()
    .from(busySlots)
    .where(
      and(
        eq(busySlots.userId, userId),
        eq(busySlots.kind, 'manual_gig'),
        sql`${busySlots.endsAt} >= ${ts(since)}`,
      ),
    )
    .orderBy(asc(busySlots.startsAt));
}
