import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Db } from '../client';
import {
  busySlots,
  comedianPhotos,
  comedianProfiles,
  eventStaff,
  events,
  organizerProfiles,
  participationEvents,
  participations,
  userRoles,
  users,
  venues,
  type BusySlot,
  type Event,
  type OrganizerProfile,
  type Participation,
  type Venue,
} from '../schema';

/** Date в сыром sql-шаблоне drizzle не сериализует — передаём ISO-строку с приведением. */
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/** Подстрока для ILIKE с экранированными спецсимволами. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Транзакция или обычное подключение — у обоих одинаковый интерфейс запросов. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export type EventInsert = typeof events.$inferInsert;
export type ParticipationStatusValue = Participation['status'];

export interface EventWithRefs {
  event: Event;
  venue: Venue;
  organizer: Pick<OrganizerProfile, 'displayName' | 'projectName'> & { userId: string };
  acceptedCount: number;
}

const acceptedCount = sql<number>`(
  select count(*)::int from ${participations} p
  where p.event_id = ${events.id} and p.status = 'accepted'
)`;

function eventWithRefsQuery(db: DbOrTx) {
  return db
    .select({
      event: events,
      venue: venues,
      organizer: {
        userId: users.id,
        displayName: sql<string>`coalesce(${organizerProfiles.displayName}, ${users.firstName})`,
        projectName: organizerProfiles.projectName,
      },
      acceptedCount,
    })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(users, eq(users.id, events.organizerId))
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, events.organizerId));
}

export async function createEvent(db: DbOrTx, data: EventInsert): Promise<Event> {
  const [row] = await db.insert(events).values(data).returning();
  return row!;
}

export async function updateEvent(
  db: DbOrTx,
  id: string,
  patch: Partial<EventInsert>,
): Promise<Event> {
  const [row] = await db
    .update(events)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(events.id, id))
    .returning();
  return row!;
}

export async function findEvent(db: DbOrTx, id: string): Promise<Event | undefined> {
  const [row] = await db.select().from(events).where(eq(events.id, id));
  return row;
}

/** Блокирует строку события до конца транзакции (изменения состава). */
export async function lockEvent(tx: Tx, id: string): Promise<Event | undefined> {
  const [row] = await tx.select().from(events).where(eq(events.id, id)).for('update');
  return row;
}

export async function findEventWithRefs(
  db: DbOrTx,
  id: string,
): Promise<EventWithRefs | undefined> {
  const [row] = await eventWithRefsQuery(db).where(eq(events.id, id));
  return row;
}

export async function findEventByLinkToken(db: DbOrTx, token: string) {
  const [row] = await db.select().from(events).where(eq(events.recruitmentLinkToken, token));
  return row;
}

/** Открытые наборы в городе: «Ищут комиков». */
export function listOpenEvents(
  db: DbOrTx,
  q: { cityId: number; from: Date; to?: Date; format?: Event['format'] },
): Promise<EventWithRefs[]> {
  return eventWithRefsQuery(db)
    .where(
      and(
        eq(venues.cityId, q.cityId),
        eq(events.status, 'recruiting'),
        eq(events.recruitmentOpen, true),
        gte(events.startsAt, q.from),
        q.to ? lte(events.startsAt, q.to) : undefined,
        q.format ? eq(events.format, q.format) : undefined,
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(100);
}

/** События организатора: предстоящие по возрастанию, прошедшие — по убыванию. */
export function listOrganizerEvents(
  db: DbOrTx,
  organizerId: string,
  when: 'upcoming' | 'past',
  now: Date,
): Promise<EventWithRefs[]> {
  const upcoming = when === 'upcoming';
  return eventWithRefsQuery(db)
    .where(
      and(
        eq(events.organizerId, organizerId),
        upcoming
          ? sql`${events.windowEndsAt} >= ${ts(now)}`
          : sql`${events.windowEndsAt} < ${ts(now)}`,
      ),
    )
    .orderBy(upcoming ? asc(events.startsAt) : desc(events.startsAt))
    .limit(200);
}

// --- Участия ---

export async function findParticipation(
  db: DbOrTx,
  id: string,
): Promise<Participation | undefined> {
  const [row] = await db.select().from(participations).where(eq(participations.id, id));
  return row;
}

export async function findUserParticipation(
  db: DbOrTx,
  eventId: string,
  comedianId: string,
): Promise<Participation | undefined> {
  const [row] = await db
    .select()
    .from(participations)
    .where(and(eq(participations.eventId, eventId), eq(participations.comedianId, comedianId)));
  return row;
}

export function listEventParticipations(db: DbOrTx, eventId: string): Promise<Participation[]> {
  return db
    .select()
    .from(participations)
    .where(eq(participations.eventId, eventId))
    .orderBy(asc(participations.position), asc(participations.createdAt));
}

/**
 * Создаёт участие или «оживляет» закрытое (unique по событию и комику):
 * повторная заявка после отзыва переиспользует строку.
 */
export async function upsertParticipation(
  db: DbOrTx,
  data: Pick<
    typeof participations.$inferInsert,
    'eventId' | 'comedianId' | 'source' | 'status' | 'invitedBy' | 'message' | 'isUrgent'
  >,
): Promise<{ participation: Participation; previousStatus: ParticipationStatusValue | null }> {
  const existing = await findUserParticipation(db, data.eventId, data.comedianId);
  if (existing) {
    const [row] = await db
      .update(participations)
      .set({
        ...data,
        position: null,
        autoAccepted: false,
        counterProposal: null,
        dayConfirmation: 'none',
        dayConfirmedAt: null,
        attendance: 'unknown',
        updatedAt: sql`now()`,
      })
      .where(eq(participations.id, existing.id))
      .returning();
    return { participation: row!, previousStatus: existing.status };
  }
  const [row] = await db.insert(participations).values(data).returning();
  return { participation: row!, previousStatus: null };
}

export async function updateParticipation(
  db: DbOrTx,
  id: string,
  patch: Partial<typeof participations.$inferInsert>,
): Promise<Participation> {
  const [row] = await db
    .update(participations)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(participations.id, id))
    .returning();
  return row!;
}

export async function recordParticipationEvent(
  db: DbOrTx,
  data: typeof participationEvents.$inferInsert,
) {
  await db.insert(participationEvents).values(data);
}

export async function bumpLineupVersion(db: DbOrTx, eventId: string) {
  await db
    .update(events)
    .set({ lineupVersion: sql`${events.lineupVersion} + 1`, updatedAt: sql`now()` })
    .where(eq(events.id, eventId));
}

/** Участия комика с событиями — для «Входящих». */
export function listComedianParticipations(
  db: DbOrTx,
  comedianId: string,
  statuses: ParticipationStatusValue[],
  since: Date,
): Promise<Array<EventWithRefs & { participation: Participation }>> {
  return db
    .select({
      participation: participations,
      event: events,
      venue: venues,
      organizer: {
        userId: users.id,
        displayName: sql<string>`coalesce(${organizerProfiles.displayName}, ${users.firstName})`,
        projectName: organizerProfiles.projectName,
      },
      acceptedCount,
    })
    .from(participations)
    .innerJoin(events, eq(events.id, participations.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .innerJoin(users, eq(users.id, events.organizerId))
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, events.organizerId))
    .where(
      and(
        eq(participations.comedianId, comedianId),
        inArray(participations.status, statuses),
        sql`${events.windowEndsAt} >= ${ts(since)}`,
      ),
    )
    .orderBy(asc(events.startsAt));
}

/** accepted-участия комика в событиях, чьё окно пересекает [from, to). */
export function listComedianGigsInRange(
  db: DbOrTx,
  comedianId: string,
  from: Date,
  to: Date,
  excludeEventId?: string,
) {
  return db
    .select({ participation: participations, event: events, venue: venues })
    .from(participations)
    .innerJoin(events, eq(events.id, participations.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(
      and(
        eq(participations.comedianId, comedianId),
        eq(participations.status, 'accepted'),
        ne(events.status, 'cancelled'),
        excludeEventId ? ne(events.id, excludeEventId) : undefined,
        sql`tstzrange(${events.startsAt}, ${events.windowEndsAt}) && tstzrange(${ts(from)}, ${ts(to)})`,
      ),
    );
}

export function listBusySlotsInRange(
  db: DbOrTx,
  userId: string,
  from: Date,
  to: Date,
): Promise<BusySlot[]> {
  return db
    .select()
    .from(busySlots)
    .where(
      and(
        eq(busySlots.userId, userId),
        sql`tstzrange(${busySlots.startsAt}, ${busySlots.endsAt}) && tstzrange(${ts(from)}, ${ts(to)})`,
      ),
    );
}

/** Позиции и длительности accepted-участий событий — чтобы посчитать окна на сцене. */
export function listAcceptedForEvents(db: DbOrTx, eventIds: string[]) {
  if (eventIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: participations.id,
      eventId: participations.eventId,
      comedianId: participations.comedianId,
      position: participations.position,
      setMinutesOverride: participations.setMinutesOverride,
    })
    .from(participations)
    .where(and(inArray(participations.eventId, eventIds), eq(participations.status, 'accepted')));
}

/** advisory-lock на комика до конца транзакции: принятия в его календарь идут по очереди. */
export async function lockComedian(tx: Tx, comedianId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${comedianId}, 0))`);
}

// --- Штат ---

export async function findStaff(db: DbOrTx, eventId: string, userId: string) {
  const [row] = await db
    .select()
    .from(eventStaff)
    .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.userId, userId)));
  return row;
}

// --- Комики ---

export interface ComedianRow {
  userId: string;
  stageName: string;
  category: 'newbie' | 'experienced' | 'media';
  cityId: number;
  contact: string;
  bio: string | null;
  links: typeof comedianProfiles.$inferSelect.links;
  travelBufferMinutes: number;
  photoKey: string | null;
}

const firstPhoto = sql<string | null>`(
  select ${comedianPhotos.previewS3Key} from ${comedianPhotos}
  where ${comedianPhotos.userId} = ${comedianProfiles.userId}
  order by ${comedianPhotos.sortOrder}, ${comedianPhotos.createdAt} limit 1
)`;

const comedianColumns = {
  userId: comedianProfiles.userId,
  stageName: comedianProfiles.stageName,
  category: comedianProfiles.category,
  cityId: comedianProfiles.cityId,
  contact: comedianProfiles.contact,
  bio: comedianProfiles.bio,
  links: comedianProfiles.links,
  travelBufferMinutes: comedianProfiles.travelBufferMinutes,
  photoKey: firstPhoto,
};

export function searchComedians(
  db: DbOrTx,
  q: { text?: string; cityId?: number; category?: ComedianRow['category']; limit?: number },
): Promise<ComedianRow[]> {
  const pattern = q.text ? likePattern(q.text) : null;
  return db
    .select(comedianColumns)
    .from(comedianProfiles)
    .where(
      and(
        eq(comedianProfiles.isSearchable, true),
        pattern ? sql`${comedianProfiles.stageName} ilike ${pattern}` : undefined,
        q.cityId ? eq(comedianProfiles.cityId, q.cityId) : undefined,
        q.category ? eq(comedianProfiles.category, q.category) : undefined,
      ),
    )
    .orderBy(asc(comedianProfiles.stageName))
    .limit(q.limit ?? 50);
}

export function findComedians(db: DbOrTx, ids: string[]): Promise<ComedianRow[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select(comedianColumns)
    .from(comedianProfiles)
    .where(inArray(comedianProfiles.userId, ids));
}

/** Выступления через приложение: accepted в событиях, которые уже прошли. */
export async function countPastGigs(db: DbOrTx, comedianId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(participations)
    .innerJoin(events, eq(events.id, participations.eventId))
    .where(
      and(
        eq(participations.comedianId, comedianId),
        eq(participations.status, 'accepted'),
        ne(events.status, 'cancelled'),
        sql`${events.windowEndsAt} < ${ts(now)}`,
      ),
    );
  return row?.n ?? 0;
}

export async function upsertStaff(
  db: DbOrTx,
  data: { eventId: string; userId: string; permissions: Record<string, boolean> },
) {
  const [row] = await db
    .insert(eventStaff)
    .values({ ...data, role: 'host' })
    .onConflictDoUpdate({
      target: [eventStaff.eventId, eventStaff.userId],
      set: { permissions: data.permissions },
    })
    .returning();
  return row!;
}

export async function deleteStaff(db: DbOrTx, eventId: string, userId: string) {
  await db
    .delete(eventStaff)
    .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.userId, userId)));
}

/** Штат события с именами: сценическое/организаторское имя или имя из Telegram. */
export function listStaff(db: DbOrTx, eventId: string) {
  return db
    .select({
      userId: eventStaff.userId,
      permissions: eventStaff.permissions,
      name: sql<string>`coalesce(${comedianProfiles.stageName}, ${organizerProfiles.displayName}, ${users.firstName})`,
      username: users.telegramUsername,
    })
    .from(eventStaff)
    .innerJoin(users, eq(users.id, eventStaff.userId))
    .leftJoin(comedianProfiles, eq(comedianProfiles.userId, eventStaff.userId))
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, eventStaff.userId))
    .where(eq(eventStaff.eventId, eventId))
    .orderBy(asc(eventStaff.createdAt));
}

/** Пользователи с ролью ведущего — для назначения на событие. */
export function searchHosts(db: DbOrTx, text: string | undefined, limit = 30) {
  const pattern = text ? likePattern(text) : null;
  const name = sql<string>`coalesce(${comedianProfiles.stageName}, ${organizerProfiles.displayName}, ${users.firstName})`;
  return db
    .select({ userId: users.id, name, username: users.telegramUsername })
    .from(users)
    .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, 'host')))
    .leftJoin(comedianProfiles, eq(comedianProfiles.userId, users.id))
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, users.id))
    .where(
      pattern
        ? sql`(${name} ilike ${pattern} or ${users.telegramUsername} ilike ${pattern})`
        : undefined,
    )
    .orderBy(asc(name))
    .limit(limit);
}

/** События, где пользователь — ведущий. */
export function listHostedEvents(db: DbOrTx, userId: string, now: Date): Promise<EventWithRefs[]> {
  return eventWithRefsQuery(db)
    .innerJoin(eventStaff, and(eq(eventStaff.eventId, events.id), eq(eventStaff.userId, userId)))
    .where(and(ne(events.status, 'draft'), sql`${events.windowEndsAt} >= ${ts(now)}`))
    .orderBy(asc(events.startsAt))
    .limit(100);
}
