import { and, asc, desc, eq, exists, gte, inArray, lte, ne, not, or, sql } from 'drizzle-orm';
import type { Db } from '../client';
import {
  busySlots,
  comedianProfiles,
  comedianTrips,
  eventStaff,
  events,
  organizerProfiles,
  participationEvents,
  participations,
  userRoles,
  users,
  venues,
  type BusySlot,
  type ComedianTrip,
  type Event,
  type OrganizerProfile,
  type Participation,
  type Venue,
} from '../schema';

/** Date в сыром sql-шаблоне drizzle не сериализует — передаём ISO-строку с приведением. */
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/** Подстрока для ILIKE с экранированными спецсимволами. */
export const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

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
  q: {
    cityId?: number;
    from: Date;
    to?: Date;
    format?: Event['format'];
  },
): Promise<EventWithRefs[]> {
  return eventWithRefsQuery(db)
    .where(
      and(
        q.cityId ? eq(venues.cityId, q.cityId) : undefined,
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

/**
 * «Карта»: опубликованные события на дату. Дата сравнивается по местному времени площадки,
 * поэтому в списке «Все города» каждое событие попадает в свой день.
 */
export function listEventsOnDate(
  db: DbOrTx,
  q: { cityId?: number; date: string },
): Promise<EventWithRefs[]> {
  return eventWithRefsQuery(db)
    .where(
      and(
        q.cityId ? eq(venues.cityId, q.cityId) : undefined,
        inArray(events.status, ['recruiting', 'lineup_locked', 'finished']),
        sql`(${events.startsAt} at time zone ${venues.timezone})::date = ${q.date}::date`,
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(200);
}

/** Сколько участий в этих статусах у каждого события. */
export async function countParticipationsByEvent(
  db: DbOrTx,
  eventIds: string[],
  statuses: ParticipationStatusValue[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  const rows = await db
    .select({ eventId: participations.eventId, n: sql<number>`count(*)::int` })
    .from(participations)
    .where(and(inArray(participations.eventId, eventIds), inArray(participations.status, statuses)))
    .groupBy(participations.eventId);
  return new Map(rows.map((r) => [r.eventId, r.n]));
}

/** Счётчики для меню: что ждёт ответа пользователя в предстоящих событиях. */
export async function countBadges(
  db: DbOrTx,
  userId: string,
  now: Date,
): Promise<{ inbox: number; events: number; hosting: number }> {
  const upcoming = sql`${events.windowEndsAt} >= ${ts(now)} and ${events.status} not in ('cancelled', 'finished')`;
  const [inbox, organizer, hosting] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(participations)
      .innerJoin(events, eq(events.id, participations.eventId))
      .where(
        and(
          eq(participations.comedianId, userId),
          or(
            and(eq(participations.source, 'invitation'), eq(participations.status, 'invited')),
            and(eq(participations.isUrgent, true), eq(participations.status, 'reserve')),
          ),
          upcoming,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(participations)
      .innerJoin(events, eq(events.id, participations.eventId))
      .where(
        and(
          eq(events.organizerId, userId),
          inArray(participations.status, ['pending', 'counter_proposed']),
          upcoming,
        ),
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(eventStaff)
      .innerJoin(events, eq(events.id, eventStaff.eventId))
      .where(and(eq(eventStaff.userId, userId), eq(eventStaff.status, 'invited'), upcoming)),
  ]);
  return {
    inbox: inbox[0]?.n ?? 0,
    events: organizer[0]?.n ?? 0,
    hosting: hosting[0]?.n ?? 0,
  };
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

// Псевдоним обязателен: без него drizzle пишет в подзапросе голое "user_id", и условие
// сравнивает колонку саму с собой — всем комикам доставалось одно и то же чужое фото.
const firstPhoto = sql<string | null>`(
  select ph.preview_s3_key from comedian_photos ph
  where ph.user_id = ${comedianProfiles}.user_id
  order by ph.sort_order, ph.created_at limit 1
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

/** Поездка попадает в запрос: идёт в эту дату, а без даты — ещё не закончилась. */
const tripInTime = (q: { date?: string; today: string }) =>
  q.date
    ? and(lte(comedianTrips.startsOn, q.date), gte(comedianTrips.endsOn, q.date))
    : gte(comedianTrips.endsOn, q.today);

export function searchComedians(
  db: DbOrTx,
  q: {
    text?: string;
    cityId?: number;
    category?: ComedianRow['category'];
    limit?: number;
    /** С городом: кто в этом городе в этот день, с учётом поездок. */
    date?: string;
    today: string;
  },
): Promise<ComedianRow[]> {
  const pattern = q.text ? likePattern(q.text) : null;
  const trips = (where: ReturnType<typeof and>) =>
    exists(
      db
        .select({ id: comedianTrips.id })
        .from(comedianTrips)
        .where(and(eq(comedianTrips.comedianId, comedianProfiles.userId), where)),
    );
  const guest = q.cityId ? trips(and(eq(comedianTrips.cityId, q.cityId), tripInTime(q))) : null;
  // В эту дату местный комик сам уехал в другой город.
  const away =
    q.cityId && q.date ? trips(and(ne(comedianTrips.cityId, q.cityId), tripInTime(q))) : null;
  return (
    db
      .select(comedianColumns)
      .from(comedianProfiles)
      .where(
        and(
          eq(comedianProfiles.isSearchable, true),
          pattern ? sql`${comedianProfiles.stageName} ilike ${pattern}` : undefined,
          q.cityId
            ? or(and(eq(comedianProfiles.cityId, q.cityId), away ? not(away) : undefined), guest!)
            : undefined,
          q.category ? eq(comedianProfiles.category, q.category) : undefined,
        ),
      )
      // Гости первыми: ради них и смотрят дату, и в лимит они должны попасть.
      .orderBy(...(guest ? [desc(guest)] : []), asc(comedianProfiles.stageName))
      .limit(q.limit ?? 50)
  );
}

/** Поездки, которые надо показать рядом с найденными комиками. Без города и даты — никакие. */
export function listTripsForSearch(
  db: DbOrTx,
  ids: string[],
  q: { cityId?: number; date?: string; today: string },
): Promise<ComedianTrip[]> {
  if (ids.length === 0 || (!q.cityId && !q.date)) return Promise.resolve([]);
  return db
    .select()
    .from(comedianTrips)
    .where(
      and(
        inArray(comedianTrips.comedianId, ids),
        q.cityId ? eq(comedianTrips.cityId, q.cityId) : undefined,
        tripInTime(q),
      ),
    )
    .orderBy(asc(comedianTrips.startsOn));
}

export function listComedianTrips(
  db: DbOrTx,
  comedianId: string,
  today: string,
): Promise<ComedianTrip[]> {
  return db
    .select()
    .from(comedianTrips)
    .where(and(eq(comedianTrips.comedianId, comedianId), gte(comedianTrips.endsOn, today)))
    .orderBy(asc(comedianTrips.startsOn));
}

export async function createComedianTrip(
  db: DbOrTx,
  data: { comedianId: string; cityId: number; startsOn: string; endsOn: string },
): Promise<ComedianTrip> {
  const [row] = await db.insert(comedianTrips).values(data).returning();
  return row!;
}

export async function deleteComedianTrip(
  db: DbOrTx,
  id: string,
  comedianId: string,
): Promise<boolean> {
  const rows = await db
    .delete(comedianTrips)
    .where(and(eq(comedianTrips.id, id), eq(comedianTrips.comedianId, comedianId)))
    .returning({ id: comedianTrips.id });
  return rows.length > 0;
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

/** Позвать ведущего. Отказавшегося можно позвать снова — он опять получит приглашение. */
export async function upsertStaff(
  db: DbOrTx,
  data: { eventId: string; userId: string; permissions: Record<string, boolean> },
) {
  const [row] = await db
    .insert(eventStaff)
    .values({ ...data, role: 'host', status: 'invited' })
    .onConflictDoUpdate({
      target: [eventStaff.eventId, eventStaff.userId],
      set: {
        permissions: data.permissions,
        status: sql`case when ${eventStaff.status} = 'declined' then 'invited'::staff_status else ${eventStaff.status} end`,
      },
    })
    .returning();
  return row!;
}

export async function setStaffStatus(
  db: DbOrTx,
  eventId: string,
  userId: string,
  status: 'accepted' | 'declined',
) {
  const [row] = await db
    .update(eventStaff)
    .set({ status })
    .where(and(eq(eventStaff.eventId, eventId), eq(eventStaff.userId, userId)))
    .returning();
  return row;
}

/** Статусы ведущего по событиям — для «Я веду». */
export function listStaffStatuses(db: DbOrTx, userId: string, eventIds: string[]) {
  if (eventIds.length === 0) return Promise.resolve([]);
  return db
    .select({ eventId: eventStaff.eventId, status: eventStaff.status })
    .from(eventStaff)
    .where(and(eq(eventStaff.userId, userId), inArray(eventStaff.eventId, eventIds)));
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
      status: eventStaff.status,
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
