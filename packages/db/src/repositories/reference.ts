import { asc, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { CITIES } from '../data/cities';
import { cities, venues, type City, type Venue } from '../schema';

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

export function listVenuesByCity(db: Db, cityId: number): Promise<Venue[]> {
  return db.select().from(venues).where(eq(venues.cityId, cityId)).orderBy(asc(venues.name));
}

export async function createVenue(
  db: Db,
  input: { name: string; address: string; cityId: number; timezone: string; createdBy: string },
): Promise<Venue> {
  const [row] = await db.insert(venues).values(input).returning();
  return row!;
}
