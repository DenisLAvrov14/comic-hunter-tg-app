import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import {
  countPhotos,
  deletePhoto,
  findCity,
  findPhoto,
  getUserRoles,
  insertPhoto,
  setUserRoles,
  updateUser,
  upsertComedianProfile,
  upsertOrganizerProfile,
  type Db,
  createComedianTrip,
  deleteComedianTrip,
  findComedians,
  findUserById,
  listComedianTrips,
} from '@standup/db';
import { tripDateError, utcToLocal } from '@standup/domain';
import {
  ComedianProfileInput,
  OrganizerProfileInput,
  PatchMeRequest,
  PHOTO_LIMIT,
  PutRolesRequest,
  type Me,
  type Photo,
  TripInput,
  TripParams,
  type Trip,
} from '@standup/shared';
import { rescheduleForUser } from '@standup/notify';
import { ApiError } from '../errors';
import { processPhoto } from '../images';
import { processImage, readUpload } from '../upload';
import { deleteAccount } from '../services/account';
import { loadMe, toPhoto } from '../services/me';
import type { FileStorage } from '../storage';

export const meRoutes: FastifyPluginAsync<{
  db: Db;
  storage: FileStorage;
  onEventChanged: (eventId: string) => Promise<void>;
}> = async (app, { db, storage, onEventChanged }) => {
  app.addHook('onRequest', app.authenticate);

  async function requireRole(userId: string, role: 'comedian' | 'organizer') {
    // Роль пользователя, а не право на событие — can() здесь не нужен.
    const roles = await getUserRoles(db, userId);
    if (!roles.includes(role)) throw new ApiError('FORBIDDEN');
  }

  async function requireCity(cityId: number) {
    const city = await findCity(db, cityId);
    if (!city) throw new ApiError('VALIDATION', 'Город не найден', { field: 'cityId' });
    return city;
  }

  app.get('/me', async (req): Promise<Me> => loadMe(db, storage, req.user.sub));

  // Удаление аккаунта с анонимизацией истории (SPEC §11).
  app.delete('/me', async (req, reply) => {
    const { changedEvents } = await deleteAccount(db, storage, req.user.sub);
    for (const id of changedEvents) await onEventChanged(id);
    return reply.status(204).send();
  });

  // --- Поездки комика ---

  const toTrip = (t: Trip): Trip => ({
    id: t.id,
    cityId: t.cityId,
    startsOn: t.startsOn,
    endsOn: t.endsOn,
  });

  async function userToday(userId: string) {
    const user = (await findUserById(db, userId))!;
    return utcToLocal(new Date(), user.timezone).slice(0, 10);
  }

  app.get('/me/trips', async (req): Promise<Trip[]> =>
    (await listComedianTrips(db, req.user.sub, await userToday(req.user.sub))).map(toTrip),
  );

  app.post('/me/trips', async (req, reply): Promise<Trip> => {
    const body = TripInput.parse(req.body);
    const userId = req.user.sub;
    await requireRole(userId, 'comedian');
    await requireCity(body.cityId);
    const [profile] = await findComedians(db, [userId]);
    if (profile?.cityId === body.cityId) {
      throw new ApiError('VALIDATION', 'Это ваш город, поездка не нужна', { field: 'cityId' });
    }
    const dateError = tripDateError(body.startsOn, body.endsOn, await userToday(userId));
    if (dateError) {
      const messages = {
        end_before_start: 'Конец поездки раньше начала',
        in_past: 'Поездка уже закончилась',
        too_long: 'Поездка — не дольше 60 дней',
      };
      throw new ApiError('VALIDATION', messages[dateError], { field: 'endsOn' });
    }
    const trip = await createComedianTrip(db, { comedianId: userId, ...body });
    reply.status(201);
    return toTrip(trip);
  });

  app.delete('/me/trips/:id', async (req, reply) => {
    const { id } = TripParams.parse(req.params);
    if (!(await deleteComedianTrip(db, id, req.user.sub))) throw new ApiError('NOT_FOUND');
    return reply.status(204).send();
  });

  app.patch('/me', async (req): Promise<Me> => {
    const body = PatchMeRequest.parse(req.body);
    await updateUser(db, req.user.sub, {
      ...(body.timezone ? { timezone: body.timezone } : {}),
      ...(body.writeAccessGranted ? { botStarted: true } : {}),
      ...(body.digestTime ? { digestTime: body.digestTime } : {}),
      ...(body.preShowMinutes !== undefined ? { preShowMinutes: body.preShowMinutes } : {}),
    });
    if (body.digestTime || body.preShowMinutes !== undefined || body.timezone) {
      await rescheduleForUser(db, req.user.sub, new Date());
    }
    return loadMe(db, storage, req.user.sub);
  });

  app.put('/me/roles', async (req): Promise<Me> => {
    const { roles } = PutRolesRequest.parse(req.body);
    await setUserRoles(db, req.user.sub, [...new Set(roles)]);
    return loadMe(db, storage, req.user.sub);
  });

  app.put('/me/comedian-profile', async (req): Promise<Me> => {
    const body = ComedianProfileInput.parse(req.body);
    await requireRole(req.user.sub, 'comedian');
    const city = await requireCity(body.cityId);
    await upsertComedianProfile(db, req.user.sub, body);
    await updateUser(db, req.user.sub, { timezone: city.timezone });
    return loadMe(db, storage, req.user.sub);
  });

  app.put('/me/organizer-profile', async (req): Promise<Me> => {
    const body = OrganizerProfileInput.parse(req.body);
    await requireRole(req.user.sub, 'organizer');
    const city = await requireCity(body.cityId);
    await upsertOrganizerProfile(db, req.user.sub, body);
    await updateUser(db, req.user.sub, { timezone: city.timezone });
    return loadMe(db, storage, req.user.sub);
  });

  // TODO(spec): ТЗ предлагает presigned upload в S3. Загружаем через API: сервер всё равно
  // должен сделать ресайз, а в dev S3 недоступен с телефона через туннель.
  app.post(
    '/me/photos',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply): Promise<Photo> => {
      const userId = req.user.sub;
      await requireRole(userId, 'comedian');
      if ((await countPhotos(db, userId)) >= PHOTO_LIMIT) {
        throw new ApiError('VALIDATION', `Можно загрузить не больше ${PHOTO_LIMIT} фото`);
      }

      const input = await readUpload(req);
      const processed = await processImage(() => processPhoto(input));

      const id = randomUUID();
      const s3Key = `photos/${userId}/${id}.jpg`;
      const previewS3Key = `photos/${userId}/${id}_400.jpg`;
      await storage.put(s3Key, processed.original, 'image/jpeg');
      await storage.put(previewS3Key, processed.preview, 'image/jpeg');

      const photo = await insertPhoto(db, {
        id,
        userId,
        s3Key,
        previewS3Key,
        width: processed.width,
        height: processed.height,
        sortOrder: await countPhotos(db, userId),
      });
      reply.status(201);
      return toPhoto(storage, photo);
    },
  );

  app.delete<{ Params: { id: string } }>('/me/photos/:id', async (req, reply) => {
    const photo = /^[0-9a-f-]{36}$/i.test(req.params.id)
      ? await findPhoto(db, req.params.id)
      : undefined;
    if (!photo || photo.userId !== req.user.sub) throw new ApiError('NOT_FOUND');
    await deletePhoto(db, photo.id);
    await storage.delete([photo.s3Key, photo.previewS3Key]).catch((err) => {
      req.log.warn({ err, photoId: photo.id }, 'failed to delete photo files');
    });
    return reply.status(204).send();
  });
};
