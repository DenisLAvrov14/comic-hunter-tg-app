import {
  findComedianProfile,
  findOrganizerProfile,
  findUserById,
  getUserRoles,
  listPhotos,
  type ComedianPhoto,
  type Db,
  type User,
} from '@standup/db';
import { onboardingStep } from '@standup/domain';
import type { Me, Photo } from '@standup/shared';
import { ApiError } from '../errors';
import type { FileStorage } from '../storage';

export function toPhoto(storage: FileStorage, p: ComedianPhoto): Photo {
  return {
    id: p.id,
    url: storage.publicUrl(p.s3Key),
    previewUrl: storage.publicUrl(p.previewS3Key),
    width: p.width,
    height: p.height,
  };
}

/** Собирает ответ GET /me: пользователь, роли, профили, фото и статус онбординга. */
export async function loadMe(db: Db, storage: FileStorage, userOrId: User | string): Promise<Me> {
  const user = typeof userOrId === 'string' ? await findUserById(db, userOrId) : userOrId;
  if (!user) throw new ApiError('UNAUTHORIZED');

  const [roles, comedian, organizer, photos] = await Promise.all([
    getUserRoles(db, user.id),
    findComedianProfile(db, user.id),
    findOrganizerProfile(db, user.id),
    listPhotos(db, user.id),
  ]);

  return {
    id: user.id,
    telegramId: user.telegramId,
    telegramUsername: user.telegramUsername,
    firstName: user.firstName,
    lastName: user.lastName,
    languageCode: user.languageCode,
    timezone: user.timezone,
    botStarted: user.botStarted,
    digestTime: user.digestTime,
    preShowMinutes: user.preShowMinutes,
    roles,
    comedianProfile: comedian
      ? {
          stageName: comedian.stageName,
          cityId: comedian.cityId,
          contact: comedian.contact,
          category: comedian.category,
          categoryVerified: comedian.categoryVerified,
          bio: comedian.bio,
          links: comedian.links,
          travelBufferMinutes: comedian.travelBufferMinutes,
          defaultSetMinutes: comedian.defaultSetMinutes,
          isSearchable: comedian.isSearchable,
          photos: photos.map((p) => toPhoto(storage, p)),
        }
      : null,
    organizerProfile: organizer
      ? {
          displayName: organizer.displayName,
          cityId: organizer.cityId,
          projectName: organizer.projectName,
          contact: organizer.contact,
        }
      : null,
    onboarded:
      onboardingStep({
        roles,
        hasComedianProfile: !!comedian,
        hasOrganizerProfile: !!organizer,
      }) === 'done',
  };
}
