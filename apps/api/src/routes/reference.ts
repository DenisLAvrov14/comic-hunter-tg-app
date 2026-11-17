import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  countVenuePhotos,
  createVenue,
  deleteVenuePhoto,
  findCity,
  findVenuePhoto,
  insertVenuePhoto,
  listAdminIds,
  listVenuePhotos,
  findVenue,
  getUserRoles,
  listCities,
  listVenuesByCity,
  listUpcomingVenueEvents,
  updateVenueInfo,
  updateVenueImages,
  type Db,
  type Venue as VenueRow,
  type VenuePhoto,
} from '@standup/db';
import { groupAfisha, normalizeWebsite } from '@standup/domain';
import {
  PHOTO_LIMIT,
  VenueInput,
  VenuePatch,
  VenuesQuery,
  type City,
  type Venue,
  type VenueListItem,
} from '@standup/shared';
import { upsertNotification } from '@standup/notify';
import { ApiError } from '../errors';
import { processLogo, processPhoto } from '../images';
import type { FileStorage } from '../storage';
import { processImage, readUpload } from '../upload';

export function toVenue(
  storage: FileStorage,
  v: VenueRow,
  userId: string,
  photos: VenuePhoto[] = [],
): Venue {
  return {
    id: v.id,
    name: v.name,
    address: v.address,
    cityId: v.cityId,
    timezone: v.timezone,
    logoUrl: v.logoS3Key ? storage.publicUrl(v.logoS3Key) : null,
    photos: photos.map((p) => ({
      id: p.id,
      url: storage.publicUrl(p.s3Key),
      previewUrl: storage.publicUrl(p.previewS3Key),
    })),
    canEdit: v.createdBy === userId,
    capacity: v.capacity,
    kind: v.kind,
    website: v.website,
    status: v.status,
    rejectReason: v.rejectReason,
  };
}

/** Фото площадок, сгруппированные по площадке. */
export async function venuePhotosById(db: Db, venueIds: string[]) {
  const byVenue = new Map<string, VenuePhoto[]>();
  for (const p of await listVenuePhotos(db, venueIds)) {
    byVenue.set(p.venueId, [...(byVenue.get(p.venueId) ?? []), p]);
  }
  return byVenue;
}

/** Файлы площадки в хранилище: лого и все фото — чтобы удалить вместе с площадкой. */
export async function venueFileKeys(db: Db, venue: VenueRow): Promise<string[]> {
  const photos = await listVenuePhotos(db, [venue.id]);
  return [venue.logoS3Key, ...photos.flatMap((p) => [p.s3Key, p.previewS3Key])].filter(
    (k): k is string => !!k,
  );
}

const VenueParams = z.object({ id: z.string().uuid() });
const PhotoParams = z.object({ id: z.string().uuid(), photoId: z.string().uuid() });

/** Сайт из запроса: undefined — не меняли; ошибка, если не похоже на адрес сайта. */
function websiteField(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const website = normalizeWebsite(value ?? '');
  if (website === undefined) {
    throw new ApiError('VALIDATION', 'Не похоже на адрес сайта', { field: 'website' });
  }
  return website;
}

export const referenceRoutes: FastifyPluginAsync<{ db: Db; storage: FileStorage }> = async (
  app,
  { db, storage },
) => {
  app.addHook('onRequest', app.authenticate);

  /** Площадка с её фото — ответ после изменений. */
  async function withPhotos(v: VenueRow, userId: string): Promise<Venue> {
    return toVenue(storage, v, userId, await listVenuePhotos(db, [v.id]));
  }

  app.get('/cities', async (): Promise<City[]> => listCities(db));

  app.get('/venues', async (req): Promise<VenueListItem[]> => {
    const { city } = VenuesQuery.parse(req.query);
    const rows = await listVenuesByCity(db, city, req.user.sub);
    // Афиша — только у проверенных: на остальных публичных событий нет.
    const approved = rows.filter((r) => r.venue.status === 'approved').map((r) => r.venue.id);
    const [events, photos] = await Promise.all([
      listUpcomingVenueEvents(db, approved, new Date()),
      venuePhotosById(
        db,
        rows.map((r) => r.venue.id),
      ),
    ]);
    const afisha = groupAfisha(events);
    return rows.map(({ venue, owner }) => {
      const a = afisha.get(venue.id);
      return {
        ...toVenue(storage, venue, req.user.sub, photos.get(venue.id)),
        owner: owner && {
          name: owner.displayName ?? [owner.firstName, owner.lastName].filter(Boolean).join(' '),
          telegramUsername: owner.telegramUsername,
          contact: owner.contact,
        },
        afisha: {
          total: a?.total ?? 0,
          items: (a?.items ?? []).map((e) => ({
            id: e.id,
            title: e.title,
            format: e.format,
            startsAt: e.startsAt.toISOString(),
          })),
        },
      };
    });
  });

  app.post('/venues', async (req, reply): Promise<Venue> => {
    const body = VenueInput.parse(req.body);
    // Роль пользователя, а не право на событие — can() здесь не нужен.
    const roles = await getUserRoles(db, req.user.sub);
    if (!roles.includes('organizer')) throw new ApiError('FORBIDDEN');
    const city = await findCity(db, body.cityId);
    if (!city) throw new ApiError('VALIDATION', 'Город не найден', { field: 'cityId' });
    const website = websiteField(body.website) ?? null;
    // Любая новая площадка — на проверку, в том числе от админа (он видит её в очереди сам).
    const venue = await db.transaction(async (tx) => {
      const created = await createVenue(tx, {
        ...body,
        website,
        timezone: city.timezone,
        createdBy: req.user.sub,
        status: 'pending',
      });
      const now = new Date();
      for (const adminId of await listAdminIds(tx)) {
        if (adminId === req.user.sub) continue;
        await upsertNotification(tx, {
          userId: adminId,
          kind: 'venue_submitted',
          sendAt: now,
          dedupeKey: `venue_submitted:${adminId}:${created.id}`,
          payload: { venueId: created.id },
        });
      }
      return created;
    });
    reply.status(201);
    return toVenue(storage, venue, req.user.sub);
  });

  /** Площадка, которую может менять текущий пользователь (её владелец). */
  async function editableVenue(id: string, userId: string): Promise<VenueRow> {
    const venue = await findVenue(db, id);
    if (!venue) throw new ApiError('NOT_FOUND');
    if (venue.createdBy !== userId) throw new ApiError('FORBIDDEN');
    return venue;
  }

  app.patch('/venues/:id', async (req): Promise<Venue> => {
    const { id } = VenueParams.parse(req.params);
    const { website, ...patch } = VenuePatch.parse(req.body);
    await editableVenue(id, req.user.sub);
    const normalized = websiteField(website);
    const updated = await updateVenueInfo(
      db,
      id,
      normalized === undefined ? patch : { ...patch, website: normalized },
    );
    return withPhotos(updated, req.user.sub);
  });

  async function dropFiles(keys: Array<string | null>) {
    const existing = keys.filter((k): k is string => !!k);
    if (existing.length) await storage.delete(existing).catch(() => {});
  }

  const uploadLimit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };

  // Ключи под photos/ — этот префикс открыт на чтение (см. storage).
  app.put('/venues/:id/logo', uploadLimit, async (req): Promise<Venue> => {
    const { id } = VenueParams.parse(req.params);
    const venue = await editableVenue(id, req.user.sub);
    const logo = await processImage(async () => processLogo(await readUpload(req)));
    const key = `photos/venues/${id}/${randomUUID()}_logo.jpg`;
    await storage.put(key, logo, 'image/jpeg');
    const updated = await updateVenueImages(db, id, { logoS3Key: key });
    await dropFiles([venue.logoS3Key]);
    return withPhotos(updated, req.user.sub);
  });

  app.delete('/venues/:id/logo', async (req): Promise<Venue> => {
    const { id } = VenueParams.parse(req.params);
    const venue = await editableVenue(id, req.user.sub);
    const updated = await updateVenueImages(db, id, { logoS3Key: null });
    await dropFiles([venue.logoS3Key]);
    return withPhotos(updated, req.user.sub);
  });

  /** Ещё одно фото в галерею площадки (листается в карточке). */
  app.post('/venues/:id/photos', uploadLimit, async (req, reply): Promise<Venue> => {
    const { id } = VenueParams.parse(req.params);
    const venue = await editableVenue(id, req.user.sub);
    const count = await countVenuePhotos(db, id);
    if (count >= PHOTO_LIMIT) {
      throw new ApiError('VALIDATION', `Можно загрузить не больше ${PHOTO_LIMIT} фото`);
    }
    const photo = await processImage(async () => processPhoto(await readUpload(req)));
    const file = randomUUID();
    const s3Key = `photos/venues/${id}/${file}.jpg`;
    const previewS3Key = `photos/venues/${id}/${file}_400.jpg`;
    await storage.put(s3Key, photo.original, 'image/jpeg');
    await storage.put(previewS3Key, photo.preview, 'image/jpeg');
    await insertVenuePhoto(db, { venueId: id, s3Key, previewS3Key, sortOrder: count });
    reply.status(201);
    return withPhotos(venue, req.user.sub);
  });

  app.delete('/venues/:id/photos/:photoId', async (req): Promise<Venue> => {
    const { id, photoId } = PhotoParams.parse(req.params);
    const venue = await editableVenue(id, req.user.sub);
    const photo = await findVenuePhoto(db, photoId);
    if (!photo || photo.venueId !== id) throw new ApiError('NOT_FOUND');
    await deleteVenuePhoto(db, photoId);
    await dropFiles([photo.s3Key, photo.previewS3Key]);
    return withPhotos(venue, req.user.sub);
  });
};
