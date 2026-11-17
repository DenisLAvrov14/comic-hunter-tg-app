// Админка: проверка площадок и список админов.
import { and, asc, count, eq, ilike, isNull, or } from 'drizzle-orm';
import type { DbOrTx } from './events';
import {
  cities,
  comedianProfiles,
  events,
  organizerProfiles,
  users,
  venues,
  type User,
  type Venue,
} from '../schema';

export interface PersonRow {
  id: string;
  telegramId: number;
  isAdmin: boolean;
  canManageAdmins: boolean;
  firstName: string;
  lastName: string | null;
  telegramUsername: string | null;
  /** Имя организатора или сценическое имя — как человека знают в приложении. */
  displayName: string | null;
  contact: string | null;
}

const person = {
  id: users.id,
  telegramId: users.telegramId,
  isAdmin: users.isAdmin,
  canManageAdmins: users.canManageAdmins,
  firstName: users.firstName,
  lastName: users.lastName,
  telegramUsername: users.telegramUsername,
  displayName: organizerProfiles.displayName,
  stageName: comedianProfiles.stageName,
  organizerContact: organizerProfiles.contact,
  comedianContact: comedianProfiles.contact,
};

type RawPerson = {
  [K in keyof typeof person]: K extends 'id' | 'firstName'
    ? string
    : K extends 'telegramId'
      ? number
      : K extends 'isAdmin' | 'canManageAdmins'
        ? boolean
        : string | null;
};

function toPerson(r: RawPerson): PersonRow {
  return {
    id: r.id,
    telegramId: r.telegramId,
    isAdmin: r.isAdmin,
    canManageAdmins: r.canManageAdmins,
    firstName: r.firstName,
    lastName: r.lastName,
    telegramUsername: r.telegramUsername,
    displayName: r.displayName ?? r.stageName,
    contact: r.organizerContact ?? r.comedianContact,
  };
}

export interface PendingVenueRow {
  venue: Venue;
  cityName: string;
  author: PersonRow | null;
}

/** Площадки на проверке — старые первыми. */
export async function listPendingVenues(db: DbOrTx): Promise<PendingVenueRow[]> {
  const rows = await db
    .select({ venue: venues, cityName: cities.name, ...person })
    .from(venues)
    .innerJoin(cities, eq(cities.id, venues.cityId))
    .leftJoin(users, eq(users.id, venues.createdBy))
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, venues.createdBy))
    .leftJoin(comedianProfiles, eq(comedianProfiles.userId, venues.createdBy))
    .where(eq(venues.status, 'pending'))
    .orderBy(asc(venues.createdAt));
  return rows.map(({ venue, cityName, ...p }) => ({
    venue,
    cityName,
    author: p.id ? toPerson(p as RawPerson) : null,
  }));
}

export async function countPendingVenues(db: DbOrTx): Promise<number> {
  const [row] = await db.select({ n: count() }).from(venues).where(eq(venues.status, 'pending'));
  return row?.n ?? 0;
}

export async function countVenueEvents(db: DbOrTx, venueId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(events).where(eq(events.venueId, venueId));
  return row?.n ?? 0;
}

/** Итог проверки; только у площадки, которая ещё на проверке (иначе undefined). */
export async function setVenueReview(
  db: DbOrTx,
  id: string,
  review: {
    status: 'approved' | 'rejected';
    reviewedBy: string;
    reviewedAt: Date;
    rejectReason?: string | null;
  },
): Promise<Venue | undefined> {
  const [row] = await db
    .update(venues)
    .set({ ...review, rejectReason: review.rejectReason ?? null })
    .where(and(eq(venues.id, id), eq(venues.status, 'pending')))
    .returning();
  return row;
}

/** Удаляет площадку на проверке; undefined — её уже нет или она не на проверке. */
export async function deletePendingVenue(db: DbOrTx, id: string): Promise<Venue | undefined> {
  const [row] = await db
    .delete(venues)
    .where(and(eq(venues.id, id), eq(venues.status, 'pending')))
    .returning();
  return row;
}

function peopleQuery(db: DbOrTx) {
  return db
    .select(person)
    .from(users)
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, users.id))
    .leftJoin(comedianProfiles, eq(comedianProfiles.userId, users.id));
}

export async function listAdmins(db: DbOrTx): Promise<PersonRow[]> {
  const rows = await peopleQuery(db)
    .where(and(eq(users.isAdmin, true), isNull(users.deletedAt)))
    .orderBy(asc(users.firstName));
  return rows.map(toPerson);
}

export async function listAdminIds(db: DbOrTx): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isAdmin, true), isNull(users.deletedAt)));
  return rows.map((r) => r.id);
}

/** Поиск людей по имени, @username, имени организатора или сценическому имени. */
export async function searchUsers(db: DbOrTx, query: string, limit = 20): Promise<PersonRow[]> {
  const q = query.trim().replace(/^@/, '');
  if (!q) return [];
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await peopleQuery(db)
    .where(
      and(
        isNull(users.deletedAt),
        or(
          ilike(users.firstName, pattern),
          ilike(users.lastName, pattern),
          ilike(users.telegramUsername, pattern),
          ilike(organizerProfiles.displayName, pattern),
          ilike(comedianProfiles.stageName, pattern),
        ),
      ),
    )
    .orderBy(asc(users.firstName))
    .limit(limit);
  return rows.map(toPerson);
}

export async function setAdminRights(
  db: DbOrTx,
  userId: string,
  rights: { isAdmin: boolean; canManageAdmins: boolean },
): Promise<User> {
  const [row] = await db.update(users).set(rights).where(eq(users.id, userId)).returning();
  return row!;
}
