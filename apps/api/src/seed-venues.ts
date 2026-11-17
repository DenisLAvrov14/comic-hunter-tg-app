// Временный каталог площадок (packages/db/src/data/venue-catalog.ts) — для бота, пока площадки
// не добавят сами. `pnpm seed:venues` — загрузить или обновить: новые сразу проверенные и без
// автора; у площадок каталога данные приводятся к каталогу, у добавленных пользователями —
// только дозаполняются пустые тип и число мест. Лого и фото загружаются, если их ещё нет.
// Повторный запуск ничего не дублирует. `pnpm seed:venues --remove` — убрать площадки каталога
// (без автора), на которых нет событий.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  and,
  countVenuePhotos,
  createDb,
  eq,
  exists,
  insertVenuePhoto,
  isNull,
  listCities,
  notExists,
  schema,
  sql,
  syncCities,
  updateVenueImages,
  venueCatalog,
  venueImagePath,
  type Venue,
} from '@standup/db';
import { catalogVenuePatch } from '@standup/domain';
import { loadConfig } from './config';
import { processLogo, processPhoto } from './images';
import { venueFileKeys } from './routes/reference';
import { S3Storage } from './storage';

const { venues, events } = schema;
const remove = process.argv.includes('--remove');
const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const storage = new S3Storage(config.s3);
if (config.s3.createBucket) await storage.ensureBucket();

await syncCities(db);
const cityByName = new Map((await listCities(db)).map((c) => [c.name, c]));

/** Площадки города с одним из названий (без учёта регистра). */
const byNames = (cityId: number, names: string[]) =>
  and(
    eq(venues.cityId, cityId),
    sql`lower(${venues.name}) in (${sql.join(
      names.map((n) => sql`lower(${n})`),
      sql`, `,
    )})`,
  );
const hasEvents = () => db.select().from(events).where(eq(events.venueId, venues.id));

async function uploadImages(venue: Venue, item: (typeof venueCatalog)[number]) {
  let uploaded = 0;
  if (item.logo && !venue.logoS3Key) {
    const logo = await processLogo(await readFile(venueImagePath(item.logo)));
    const key = `photos/venues/${venue.id}/${randomUUID()}_logo.jpg`;
    await storage.put(key, logo, 'image/jpeg');
    await updateVenueImages(db, venue.id, { logoS3Key: key });
    uploaded += 1;
  }
  if (item.photo && (await countVenuePhotos(db, venue.id)) === 0) {
    const photo = await processPhoto(await readFile(venueImagePath(item.photo)));
    const file = randomUUID();
    const s3Key = `photos/venues/${venue.id}/${file}.jpg`;
    const previewS3Key = `photos/venues/${venue.id}/${file}_400.jpg`;
    await storage.put(s3Key, photo.original, 'image/jpeg');
    await storage.put(previewS3Key, photo.preview, 'image/jpeg');
    await insertVenuePhoto(db, { venueId: venue.id, s3Key, previewS3Key, sortOrder: 0 });
    uploaded += 1;
  }
  return uploaded;
}

const stats = { added: 0, updated: 0, unchanged: 0, images: 0, removed: 0, kept: 0 };
for (const item of venueCatalog) {
  const city = cityByName.get(item.city);
  if (!city) {
    console.warn(`нет города «${item.city}» — пропуск «${item.name}»`);
    continue;
  }
  const names = [item.name, ...(item.aliases ?? [])];

  if (remove) {
    // Файлы — до удаления: фото удаляются из базы каскадом.
    const candidates = await db
      .select()
      .from(venues)
      .where(and(byNames(city.id, names), isNull(venues.createdBy), notExists(hasEvents())));
    const files = (await Promise.all(candidates.map((v) => venueFileKeys(db, v)))).flat();
    const deleted = await db
      .delete(venues)
      .where(and(byNames(city.id, names), isNull(venues.createdBy), notExists(hasEvents())))
      .returning();
    if (files.length) await storage.delete(files).catch(() => {});
    stats.removed += deleted.length;
    const left = await db
      .select({ id: venues.id })
      .from(venues)
      .where(and(byNames(city.id, names), isNull(venues.createdBy), exists(hasEvents())));
    stats.kept += left.length;
    continue;
  }

  // Своя площадка каталога (без автора) — в приоритете перед добавленной пользователем.
  const found = await db
    .select()
    .from(venues)
    .where(byNames(city.id, names))
    .orderBy(sql`${venues.createdBy} is not null`);
  let venue = found[0];
  if (!venue) {
    [venue] = await db
      .insert(venues)
      .values({
        name: item.name,
        address: item.address,
        cityId: city.id,
        timezone: city.timezone,
        kind: item.kind,
        capacity: item.capacity ?? null,
        website: item.website ?? null,
        status: 'approved',
      })
      .returning();
    stats.added += 1;
  } else {
    const patch = catalogVenuePatch(venue, item);
    if (Object.keys(patch).length) {
      [venue] = await db.update(venues).set(patch).where(eq(venues.id, venue.id)).returning();
      stats.updated += 1;
    } else {
      stats.unchanged += 1;
    }
  }
  stats.images += await uploadImages(venue!, item);
}

console.log(
  remove
    ? `убрано площадок: ${stats.removed}; оставлено (на них есть события): ${stats.kept}`
    : `добавлено: ${stats.added}; обновлено: ${stats.updated}; без изменений: ${stats.unchanged}; загружено картинок: ${stats.images}`,
);
await close();
