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
} from '@standup/db';
import {
  ComedianProfileInput,
  OrganizerProfileInput,
  PatchMeRequest,
  PHOTO_LIMIT,
  PHOTO_MAX_BYTES,
  PutRolesRequest,
  type Me,
  type Photo,
} from '@standup/shared';
import { rescheduleForUser } from '@standup/notify';
import { ApiError } from '../errors';
import { processPhoto, UnsupportedImageError } from '../images';
import { loadMe, toPhoto } from '../services/me';
import type { FileStorage } from '../storage';

export const meRoutes: FastifyPluginAsync<{ db: Db; storage: FileStorage }> = async (
  app,
  { db, storage },
) => {
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

      const file = await req.file({ limits: { fileSize: PHOTO_MAX_BYTES, files: 1 } });
      if (!file) throw new ApiError('VALIDATION', 'Файл не передан');
      const input = await file.toBuffer().catch((err: { code?: string }) => {
        if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new ApiError('VALIDATION', 'Файл больше 10 МБ');
        }
        throw err;
      });

      let processed;
      try {
        processed = await processPhoto(input);
      } catch (err) {
        if (err instanceof UnsupportedImageError) {
          throw new ApiError('VALIDATION', 'Поддерживаются JPEG, PNG, WebP и HEIC');
        }
        throw err;
      }

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
