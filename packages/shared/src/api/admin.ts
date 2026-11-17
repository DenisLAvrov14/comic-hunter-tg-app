import { z } from 'zod';
import { Venue } from './profiles';

/** Человек в админке: кто добавил площадку, админ, результат поиска. */
export const AdminPerson = z.object({
  id: z.string().uuid(),
  /** Имя организатора, сценическое имя или имя из Telegram. */
  name: z.string(),
  telegramUsername: z.string().nullable(),
  contact: z.string().nullable(),
  isAdmin: z.boolean(),
  /** Может назначать и снимать админов. */
  canManageAdmins: z.boolean(),
  /** Главный — из настройки сервера, его права не меняются из приложения. */
  isOwner: z.boolean(),
});
export type AdminPerson = z.infer<typeof AdminPerson>;

export const PendingVenue = z.object({
  venue: Venue,
  cityName: z.string(),
  /** null — автор удалил аккаунт. */
  author: AdminPerson.nullable(),
  createdAt: z.string(),
});
export type PendingVenue = z.infer<typeof PendingVenue>;

export const RejectVenueRequest = z.object({
  reason: z.string().trim().max(300).nullable().optional(),
});
export type RejectVenueRequest = z.infer<typeof RejectVenueRequest>;

export const VenueReviewResult = z.object({
  /** approved — проверена; deleted — удалена; rejected — скрыта, на ней есть события. */
  result: z.enum(['approved', 'deleted', 'rejected']),
});
export type VenueReviewResult = z.infer<typeof VenueReviewResult>;

export const AdminUsersQuery = z.object({
  q: z.string().trim().min(1).max(64),
});

export const AdminUserParams = z.object({ id: z.string().uuid() });
