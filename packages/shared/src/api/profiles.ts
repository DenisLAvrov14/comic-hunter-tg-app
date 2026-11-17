import { z } from 'zod';

/** Календарная дата yyyy-MM-dd, которая действительно существует. */
export const IsoDate = z.string().refine((s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const at = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === s;
}, 'Формат даты: ГГГГ-ММ-ДД');

export const TripInput = z.object({
  cityId: z.number().int().positive(),
  startsOn: IsoDate,
  endsOn: IsoDate,
});
export type TripInput = z.infer<typeof TripInput>;

export const Trip = TripInput.extend({ id: z.string().uuid() });
export type Trip = z.infer<typeof Trip>;

export const TripParams = z.object({ id: z.string().uuid() });

export const countries = [
  'RU',
  'KZ',
  'UZ',
  'KG',
  'TJ',
  'BY',
  'GE',
  'AM',
  'RS',
  'PL',
  'ES',
  'TR',
  'DE',
  'CZ',
  'NL',
] as const;
export const Country = z.enum(countries);
export type Country = z.infer<typeof Country>;

/** Регионы, по которым сгруппированы города в списках: Россия, Центральная Азия, Европа. */
export const regions = ['RU', 'CA', 'EU'] as const;
export type Region = (typeof regions)[number];

const centralAsia: readonly Country[] = ['KZ', 'UZ', 'KG', 'TJ'];

export function regionOf(country: Country): Region {
  if (country === 'RU') return 'RU';
  return centralAsia.includes(country) ? 'CA' : 'EU';
}

/** Города в фильтрах и форме события, по порядку. Остальные города есть только в профиле. */
export const filterCityNames: Record<Region, readonly string[]> = {
  RU: [
    'Москва',
    'Санкт-Петербург',
    'Новосибирск',
    'Екатеринбург',
    'Казань',
    'Красноярск',
    'Нижний Новгород',
    'Краснодар',
    'Ростов-на-Дону',
    'Самара',
    'Воронеж',
    'Пермь',
    'Хабаровск',
    'Саратов',
    'Волгоград',
    'Нальчик',
  ],
  CA: ['Алматы', 'Астана', 'Ташкент', 'Бишкек', 'Душанбе', 'Шымкент', 'Караганда'],
  EU: [
    'Минск',
    'Тбилиси',
    'Ереван',
    'Белград',
    'Варшава',
    'Барселона',
    'Стамбул',
    'Берлин',
    'Прага',
    'Амстердам',
  ],
};

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

/** Соцсети с отдельным полем в профиле; видео и прочее — списком ссылок. */
export const socialLinkTypes = [
  'telegram',
  'instagram',
  'youtube',
  'vk',
  'tiktok',
] as const satisfies readonly LinkType[];
export type SocialLinkType = (typeof socialLinkTypes)[number];

const socialBase: Record<SocialLinkType, string> = {
  telegram: 'https://t.me/',
  instagram: 'https://instagram.com/',
  youtube: 'https://youtube.com/@',
  vk: 'https://vk.com/',
  tiktok: 'https://www.tiktok.com/@',
};

/**
 * Поле соцсети принимает ссылку или ник: «@name», «name», «t.me/name».
 * Возвращает https-ссылку; пустое поле — null.
 */
export function socialUrl(type: SocialLinkType, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  // Ссылка без схемы: есть точка до первого слэша.
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(value)) return `https://${value}`;
  return socialBase[type] + value.replace(/^@/, '');
}

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
  // 5 соцсетей отдельными полями + видео и прочие ссылки.
  links: z.array(ProfileLink).max(20).optional(),
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

/** Тип площадки: стендап-клуб, бар, концертный зал, другое. */
export const venueKinds = ['club', 'bar', 'hall', 'other'] as const;
export const VenueKind = z.enum(venueKinds);
export type VenueKind = z.infer<typeof VenueKind>;

export const Venue = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string(),
  cityId: z.number().int(),
  timezone: z.string(),
  /** Лого в списке площадок (квадрат). */
  logoUrl: z.string().nullable(),
  /** Фото площадки (галерея, листается в карточке): превью и оригинал. */
  photos: z.array(z.object({ id: z.string().uuid(), url: z.string(), previewUrl: z.string() })),
  /** Менять лого и фото может тот, кто добавил площадку. */
  canEdit: z.boolean(),
  /** Мест в зале; null — не указано. */
  capacity: z.number().int().nullable(),
  /** Тип площадки; null — не указан (старые площадки). */
  kind: VenueKind.nullable(),
  /** Сайт площадки, полный URL; null — не указан. */
  website: z.string().nullable(),
  /** На проверке и отклонённую видит только автор. */
  status: z.enum(['pending', 'approved', 'rejected']),
  /** Причина отказа — у отклонённой. */
  rejectReason: z.string().nullable(),
});
export type Venue = z.infer<typeof Venue>;

export const VENUE_CAPACITY_MAX = 10_000;
const capacity = z.number().int().min(1).max(VENUE_CAPACITY_MAX);

export const VenueInput = z.object({
  name: text(100),
  address: text(200),
  cityId: z.number().int().positive(),
  capacity,
  kind: VenueKind,
  /** Сайт — по желанию; без https:// — добавится. */
  website: z.string().trim().max(300).nullable().optional(),
});
export type VenueInput = z.infer<typeof VenueInput>;

export const VenuePatch = z.object({
  capacity: capacity.optional(),
  kind: VenueKind.optional(),
  website: z.string().trim().max(300).nullable().optional(),
});
export type VenuePatch = z.infer<typeof VenuePatch>;

export const VenuesQuery = z.object({
  city: z.coerce.number().int().positive(),
});

export const PHOTO_LIMIT = 10;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_PREVIEW_WIDTH = 400;
