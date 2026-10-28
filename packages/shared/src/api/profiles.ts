import { z } from 'zod';

export const countries = ['RU', 'KZ'] as const;
export const Country = z.enum(countries);
export type Country = z.infer<typeof Country>;

export const City = z.object({
  id: z.number().int(),
  name: z.string(),
  country: Country,
  timezone: z.string(),
});
export type City = z.infer<typeof City>;

export const comedianCategories = ['newbie', 'experienced', 'media'] as const;
export const ComedianCategory = z.enum(comedianCategories);
export type ComedianCategory = z.infer<typeof ComedianCategory>;

export const linkTypes = [
  'video',
  'telegram',
  'instagram',
  'youtube',
  'vk',
  'tiktok',
  'other',
] as const;
export const LinkType = z.enum(linkTypes);
export type LinkType = z.infer<typeof LinkType>;

export const ProfileLink = z.object({
  type: LinkType,
  url: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), 'Только http(s)-ссылки'),
});
export type ProfileLink = z.infer<typeof ProfileLink>;

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * Профиль комика. Обязательны только сценическое имя, город и контакт;
 * остальные поля можно не передавать — тогда сохраняются прежние значения.
 */
export const ComedianProfileInput = z.object({
  stageName: text(64),
  cityId: z.number().int().positive(),
  contact: text(128),
  category: ComedianCategory.optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  links: z.array(ProfileLink).max(10).optional(),
  travelBufferMinutes: z.number().int().min(0).max(240).optional(),
  defaultSetMinutes: z.number().int().min(1).max(120).nullable().optional(),
  isSearchable: z.boolean().optional(),
});
export type ComedianProfileInput = z.infer<typeof ComedianProfileInput>;

export const Photo = z.object({
  id: z.string().uuid(),
  url: z.string(),
  previewUrl: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});
export type Photo = z.infer<typeof Photo>;

export const ComedianProfile = z.object({
  stageName: z.string(),
  cityId: z.number().int(),
  contact: z.string(),
  category: ComedianCategory,
  categoryVerified: z.boolean(),
  bio: z.string().nullable(),
  links: z.array(ProfileLink),
  travelBufferMinutes: z.number().int(),
  defaultSetMinutes: z.number().int().nullable(),
  isSearchable: z.boolean(),
  photos: z.array(Photo),
});
export type ComedianProfile = z.infer<typeof ComedianProfile>;

export const OrganizerProfileInput = z.object({
  displayName: text(64),
  cityId: z.number().int().positive(),
  projectName: z.string().trim().max(64).nullable().optional(),
  contact: z.string().trim().max(128).nullable().optional(),
});
export type OrganizerProfileInput = z.infer<typeof OrganizerProfileInput>;

export const OrganizerProfile = z.object({
  displayName: z.string(),
  cityId: z.number().int(),
  projectName: z.string().nullable(),
  contact: z.string().nullable(),
});
export type OrganizerProfile = z.infer<typeof OrganizerProfile>;

export const Venue = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  cityId: z.number().int(),
  timezone: z.string(),
});
export type Venue = z.infer<typeof Venue>;

export const VenueInput = z.object({
  name: text(100),
  address: text(200),
  cityId: z.number().int().positive(),
});
export type VenueInput = z.infer<typeof VenueInput>;

export const VenuesQuery = z.object({
  city: z.coerce.number().int().positive(),
});

export const PHOTO_LIMIT = 10;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_PREVIEW_WIDTH = 400;
