import { z } from 'zod';
import { ComedianProfile, OrganizerProfile } from './profiles';

export const userRoles = ['comedian', 'organizer', 'host'] as const;
export const UserRole = z.enum(userRoles);
export type UserRole = z.infer<typeof UserRole>;

export const Me = z.object({
  id: z.string().uuid(),
  telegramId: z.number().int(),
  telegramUsername: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string().nullable(),
  languageCode: z.string().nullable(),
  timezone: z.string(),
  botStarted: z.boolean(),
  roles: z.array(UserRole),
  comedianProfile: ComedianProfile.nullable(),
  organizerProfile: OrganizerProfile.nullable(),
  /** Пройдены ли обязательные шаги онбординга (роли + минимальные профили). */
  onboarded: z.boolean(),
});
export type Me = z.infer<typeof Me>;

export const PutRolesRequest = z.object({
  roles: z.array(UserRole).min(1).max(userRoles.length),
});
export type PutRolesRequest = z.infer<typeof PutRolesRequest>;

export const PatchMeRequest = z.object({
  timezone: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Неизвестная таймзона')
    .optional(),
  /** Пользователь разрешил боту писать ему (requestWriteAccess в Mini App). */
  writeAccessGranted: z.literal(true).optional(),
});
export type PatchMeRequest = z.infer<typeof PatchMeRequest>;
