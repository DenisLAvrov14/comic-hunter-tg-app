import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createVenue,
  findCity,
  listAdminIds,
  findVenue,
  getUserRoles,
  listCities,
  listVenuesByCity,
  listUpcomingVenueEvents,
  updateVenueInfo,
  updateVenueImages,
  type Db,
  type Venue as VenueRow,
} from '@standup/db';
import { groupAfisha } from '@standup/domain';
import {
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

export function toVenue(storage: FileStorage, v: VenueRow, userId: string): Venue {
  return {
    id: v.id,
    name: v.name,
    address: v.address,
    cityId: v.cityId,
    timezone: v.timezone,
    logoUrl: v.logoS3Key ? storage.publicUrl(v.logoS3Key) : null,
    photo:
      v.photoS3Key && v.photoPreviewS3Key
        ? {
            url: storage.publicUrl(v.photoS3Key),
            previewUrl: storage.publicUrl(v.photoPreviewS3Key),
          }
        : null,
    canEdit: v.createdBy === userId,
    capacity: v.capacity,
    kind: v.kind,
    status: v.status,
    rejectReason: v.rejectReason,
  };
}

const VenueParams = z.object({ id: z.string().uuid() });
const ImageParams = z.object({ id: z.string().uuid(), kind: z.enum(['logo', 'photo']) });

export const referenceRoutes: FastifyPluginAsync<{ db: Db; storage: FileStorage }> = async (
  app,
  { db, storage },
) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/cities', async (): Promise<City[]> => listCities(db));

  app.get('/venues', async (req): Promise<VenueListItem[]> => {
    const { city } = VenuesQuery.parse(req.query);
    const rows = await listVenuesByCity(db, city, req.user.sub);
    // Афиша — только у проверенных: на остальных публичных событий нет.
    const approved = rows.filter((r) => r.venue.status === 'approved').map((r) => r.venue.id);
    const afisha = groupAfisha(await listUpcomingVenueEvents(db, approved, new Date()));
    return rows.map(({ venue, owner }) => {
      const a = afisha.get(venue.id);
      return {
        ...toVenue(storage, venue, req.user.sub),
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
    // Любая новая площадка — на проверку, в том числе от админа (он видит её в очереди сам).
    const venue = await db.transaction(async (tx) => {
      const created = await createVenue(tx, {
        ...body,
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

  /** Площадка, которую может менять текущий пользователь (тот, кто её добавил). */
  async function editableVenue(id: string, userId: string): Promise<VenueRow> {
    const venue = await findVenue(db, id);
    if (!venue) throw new ApiError('NOT_FOUND');
    if (venue.createdBy !== userId) throw new ApiError('FORBIDDEN');
    return venue;
  }

  app.patch('/venues/:id', async (req): Promise<Venue> => {
    const { id } = VenueParams.parse(req.params);
    const patch = VenuePatch.parse(req.body);
    await editableVenue(id, req.user.sub);
    return toVenue(storage, await updateVenueInfo(db, id, patch), req.user.sub);
  });

  async function dropFiles(keys: Array<string | null>) {
    const existing = keys.filter((k): k is string => !!k);
    if (existing.length) await storage.delete(existing).catch(() => {});
  }

  // Ключи под photos/ — этот префикс открыт на чтение (см. storage).
  app.put(
    '/venues/:id/:kind',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req): Promise<Venue> => {
      const { id, kind } = ImageParams.parse(req.params);
      const venue = await editableVenue(id, req.user.sub);
      const input = await readUpload(req);
      const file = randomUUID();
      let updated: VenueRow;
      if (kind === 'logo') {
        const logo = await processImage(() => processLogo(input));
        const key = `photos/venues/${id}/${file}_logo.jpg`;
        await storage.put(key, logo, 'image/jpeg');
        updated = await updateVenueImages(db, id, { logoS3Key: key });
        await dropFiles([venue.logoS3Key]);
      } else {
        const photo = await processImage(() => processPhoto(input));
        const key = `photos/venues/${id}/${file}.jpg`;
        const previewKey = `photos/venues/${id}/${file}_400.jpg`;
        await storage.put(key, photo.original, 'image/jpeg');
        await storage.put(previewKey, photo.preview, 'image/jpeg');
        updated = await updateVenueImages(db, id, {
          photoS3Key: key,
          photoPreviewS3Key: previewKey,
        });
        await dropFiles([venue.photoS3Key, venue.photoPreviewS3Key]);
      }
      return toVenue(storage, updated, req.user.sub);
    },
  );

  app.delete('/venues/:id/:kind', async (req): Promise<Venue> => {
    const { id, kind } = ImageParams.parse(req.params);
    const venue = await editableVenue(id, req.user.sub);
    const updated = await updateVenueImages(
      db,
      id,
      kind === 'logo' ? { logoS3Key: null } : { photoS3Key: null, photoPreviewS3Key: null },
    );
    await dropFiles(
      kind === 'logo' ? [venue.logoS3Key] : [venue.photoS3Key, venue.photoPreviewS3Key],
    );
    return toVenue(storage, updated, req.user.sub);
  });
};
