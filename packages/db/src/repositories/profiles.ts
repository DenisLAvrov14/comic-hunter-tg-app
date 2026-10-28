import { asc, count, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import {
  comedianPhotos,
  comedianProfiles,
  organizerProfiles,
  userRoles,
  users,
  type ComedianPhoto,
  type ComedianProfile,
  type OrganizerProfile,
  type ProfileLink,
} from '../schema';

type Role = (typeof userRoles.$inferInsert)['role'];

export async function setUserRoles(db: Db, userId: string, roles: Role[]) {
  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    if (roles.length > 0) {
      await tx.insert(userRoles).values(roles.map((role) => ({ userId, role })));
    }
  });
}

export async function updateUser(
  db: Db,
  userId: string,
  patch: { timezone?: string; botStarted?: boolean },
) {
  if (Object.keys(patch).length === 0) return;
  await db
    .update(users)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(users.id, userId));
}

export interface ComedianProfileData {
  stageName: string;
  cityId: number;
  contact: string;
  category?: ComedianProfile['category'];
  bio?: string | null;
  links?: ProfileLink[];
  travelBufferMinutes?: number;
  defaultSetMinutes?: number | null;
  isSearchable?: boolean;
}

/** Обязательные поля перезаписываются, необязательные — только если переданы. */
export async function upsertComedianProfile(
  db: Db,
  userId: string,
  data: ComedianProfileData,
): Promise<ComedianProfile> {
  const defined = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  ) as ComedianProfileData;
  const [row] = await db
    .insert(comedianProfiles)
    .values({ userId, ...defined })
    .onConflictDoUpdate({
      target: comedianProfiles.userId,
      set: { ...defined, updatedAt: sql`now()` },
    })
    .returning();
  return row!;
}

export async function findComedianProfile(db: Db, userId: string) {
  const [row] = await db.select().from(comedianProfiles).where(eq(comedianProfiles.userId, userId));
  return row;
}

export interface OrganizerProfileData {
  displayName: string;
  cityId: number;
  projectName?: string | null;
  contact?: string | null;
}

export async function upsertOrganizerProfile(
  db: Db,
  userId: string,
  data: OrganizerProfileData,
): Promise<OrganizerProfile> {
  const defined = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  ) as OrganizerProfileData;
  const [row] = await db
    .insert(organizerProfiles)
    .values({ userId, ...defined })
    .onConflictDoUpdate({
      target: organizerProfiles.userId,
      set: { ...defined, updatedAt: sql`now()` },
    })
    .returning();
  return row!;
}

export async function findOrganizerProfile(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(organizerProfiles)
    .where(eq(organizerProfiles.userId, userId));
  return row;
}

export function listPhotos(db: Db, userId: string): Promise<ComedianPhoto[]> {
  return db
    .select()
    .from(comedianPhotos)
    .where(eq(comedianPhotos.userId, userId))
    .orderBy(asc(comedianPhotos.sortOrder), asc(comedianPhotos.createdAt));
}

export async function countPhotos(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(comedianPhotos)
    .where(eq(comedianPhotos.userId, userId));
  return row?.n ?? 0;
}

export async function insertPhoto(
  db: Db,
  data: Omit<typeof comedianPhotos.$inferInsert, 'createdAt'>,
): Promise<ComedianPhoto> {
  const [row] = await db.insert(comedianPhotos).values(data).returning();
  return row!;
}

export async function findPhoto(db: Db, id: string): Promise<ComedianPhoto | undefined> {
  const [row] = await db.select().from(comedianPhotos).where(eq(comedianPhotos.id, id));
  return row;
}

export async function deletePhoto(db: Db, id: string) {
  await db.delete(comedianPhotos).where(eq(comedianPhotos.id, id));
}
