import { and, asc, count, eq, gte, inArray, or } from 'drizzle-orm';
import type { Db } from '../client';
import type { DbOrTx } from './events';
import { CITIES } from '../data/cities';
import {
  cities,
  events,
  organizerProfiles,
  users,
  venuePhotos,
  venues,
  type City,
  type Venue,
  type VenuePhoto,
} from '../schema';

/** Справочник городов — идемпотентно, вызывается после миграций. */
export async function syncCities(db: Db) {
  await db
    .insert(cities)
    .values([...CITIES])
    .onConflictDoNothing({ target: [cities.name, cities.country] });
}

export function listCities(db: Db): Promise<City[]> {
  return db.select().from(cities).orderBy(asc(cities.country), asc(cities.id));
}

export async function findCity(db: Db, id: number): Promise<City | undefined> {
  const [row] = await db.select().from(cities).where(eq(cities.id, id));
  return row;
}

/** Кто добавил площадку — чтобы с ним можно было связаться. */
export interface VenueOwnerRow {
  firstName: string;
  lastName: string | null;
  telegramUsername: string | null;
  /** Имя организатора и его контакт из профиля. */
  displayName: string | null;
  contact: string | null;
}

/** Площадки города, которые видит пользователь: проверенные и свои (canSeeVenue в domain). */
export async function listVenuesByCity(
  db: Db,
  cityId: number,
  viewerId: string,
): Promise<Array<{ venue: Venue; owner: VenueOwnerRow | null }>> {
  const rows = await db
    .select({
      venue: venues,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      telegramUsername: users.telegramUsername,
      deletedAt: users.deletedAt,
      displayName: organizerProfiles.displayName,
      contact: organizerProfiles.contact,
    })
    .from(venues)
    .leftJoin(users, eq(users.id, venues.createdBy))
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, venues.createdBy))
    .where(
      and(
        eq(venues.cityId, cityId),
        or(eq(venues.status, 'approved'), eq(venues.createdBy, viewerId)),
      ),
    )
    .orderBy(asc(venues.name));
  return rows.map(({ venue, userId, deletedAt, firstName, ...owner }) => ({
    venue,
    owner: userId && firstName !== null && !deletedAt ? { firstName, ...owner } : null,
  }));
}

/** Предстоящие публичные события площадок (идут или ещё не начались) — для афиши. */
export function listUpcomingVenueEvents(db: DbOrTx, venueIds: string[], now: Date) {
  if (venueIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: events.id,
      venueId: events.venueId,
      title: events.title,
      format: events.format,
      startsAt: events.startsAt,
    })
    .from(events)
    .where(
      and(
        inArray(events.venueId, venueIds),
        inArray(events.status, ['recruiting', 'lineup_locked']),
        gte(events.windowEndsAt, now),
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(2000);
}

export async function findVenue(db: DbOrTx, id: string): Promise<Venue | undefined> {
  const [row] = await db.select().from(venues).where(eq(venues.id, id));
  return row;
}

export async function updateVenueImages(
  db: Db,
  id: string,
  patch: Partial<Pick<Venue, 'logoS3Key'>>,
): Promise<Venue> {
  const [row] = await db.update(venues).set(patch).where(eq(venues.id, id)).returning();
  return row!;
}

/** Мест в зале и тип площадки (меняет тот, кто добавил площадку). */
export async function updateVenueInfo(
  db: DbOrTx,
  id: string,
  patch: { capacity?: number | null; kind?: Venue['kind']; website?: string | null },
): Promise<Venue> {
  const [row] = await db.update(venues).set(patch).where(eq(venues.id, id)).returning();
  return row!;
}

export async function createVenue(
  db: DbOrTx,
  input: {
    name: string;
    address: string;
    cityId: number;
    timezone: string;
    createdBy: string;
    capacity?: number | null;
    kind?: Venue['kind'];
    website?: string | null;
    /** По умолчанию — на проверке; сиды создают сразу проверенные. */
    status?: Venue['status'];
  },
): Promise<Venue> {
  const [row] = await db.insert(venues).values(input).returning();
  return row!;
}

/** Фото площадок по порядку — для карточек. */
export function listVenuePhotos(db: DbOrTx, venueIds: string[]): Promise<VenuePhoto[]> {
  if (venueIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(venuePhotos)
    .where(inArray(venuePhotos.venueId, venueIds))
    .orderBy(asc(venuePhotos.sortOrder), asc(venuePhotos.createdAt));
}

export async function countVenuePhotos(db: DbOrTx, venueId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(venuePhotos)
    .where(eq(venuePhotos.venueId, venueId));
  return row?.n ?? 0;
}

export async function insertVenuePhoto(
  db: DbOrTx,
  data: Omit<typeof venuePhotos.$inferInsert, 'createdAt'>,
): Promise<VenuePhoto> {
  const [row] = await db.insert(venuePhotos).values(data).returning();
  return row!;
}

export async function findVenuePhoto(db: DbOrTx, id: string): Promise<VenuePhoto | undefined> {
  const [row] = await db.select().from(venuePhotos).where(eq(venuePhotos.id, id));
  return row;
}

export async function deleteVenuePhoto(db: DbOrTx, id: string) {
  await db.delete(venuePhotos).where(eq(venuePhotos.id, id));
}
