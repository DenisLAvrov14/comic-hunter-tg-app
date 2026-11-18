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

/** Регионы, по которым сгруппированы города в списках, по порядку: Центральная Азия, Россия, Европа. */
export const regions = ['CA', 'RU', 'EU'] as const;
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

/** Длины сетов, из которых комик выбирает свои (можно все). */
export const SET_LENGTHS = [3, 5, 10, 15, 20, 30, 60] as const;
/** Языки выступлений. */
export const comedianLanguages = ['ru', 'en', 'kk'] as const;
export const ComedianLanguage = z.enum(comedianLanguages);
export type ComedianLanguage = z.infer<typeof ComedianLanguage>;
export const GIGS_PER_MONTH_MAX = 100;

const SetLength = z
  .number()
  .int()
  .refine((n) => (SET_LENGTHS as readonly number[]).includes(n), 'Нет такой длины сета');
/** Уникальные значения по возрастанию — порядок выбора не важен. */
const uniqueSorted = <T extends number | string>(xs: T[]) =>
  [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Опыт комика: стаж, частота, сеты, языки. Входит и в профиль, и в карточку. */
export const ComedianExperience = z.object({
  startedYear: z.number().int().nullable(),
  gigsPerMonth: z.number().int().nullable(),
  /** Примерно выступлений всего (ступенькой: 500 → «500+»), null — не посчитать. */
  totalGigsEstimate: z.number().int().nullable(),
  setLengths: z.array(z.number().int()),
  languages: z.array(ComedianLanguage),
});
export type ComedianExperience = z.infer<typeof ComedianExperience>;

/**
 * Профиль комика. Обязательны только сценическое имя, город и контакт;
 * остальные поля можно не передавать — тогда сохраняются прежние значения.
 */
export const ComedianProfileInput = z.object({
  stageName: text(64),
  cityId: z.number().int().positive(),
  contact: text(128),
  bio: z.string().trim().max(1000).nullable().optional(),
  // 5 соцсетей отдельными полями + видео и прочие ссылки.
  links: z.array(ProfileLink).max(20).optional(),
  travelBufferMinutes: z.number().int().min(0).max(240).optional(),
  defaultSetMinutes: z.number().int().min(1).max(120).nullable().optional(),
  /** Год первого выступления; не позже текущего — проверяет сервер. */
  startedYear: z.number().int().min(1970).max(2100).nullable().optional(),
  gigsPerMonth: z.number().int().min(0).max(GIGS_PER_MONTH_MAX).nullable().optional(),
  setLengths: z.array(SetLength).max(SET_LENGTHS.length).transform(uniqueSorted).optional(),
  /** Без повторов и в порядке списка языков: русский, английский, казахский. */
  languages: z
    .array(ComedianLanguage)
    .max(comedianLanguages.length)
    .transform((xs) => comedianLanguages.filter((l) => xs.includes(l)))
    .optional(),
  isSearchable: z.boolean().optional(),
});
export type ComedianProfileInput = z.input<typeof ComedianProfileInput>;

export const Photo = z.object({
  id: z.string().uuid(),
  url: z.string(),
  previewUrl: z.string(),
  width: z.number().int(),
  height: z.number().int(),
});
export type Photo = z.infer<typeof Photo>;

export const ComedianProfile = ComedianExperience.extend({
  stageName: z.string(),
  cityId: z.number().int(),
  contact: z.string(),
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
  /** Мест на площадке; null — не указано. При нескольких залах — сумма. */
  capacity: z.number().int().nullable(),
  /** Залы, если их несколько; пусто — один зал. */
  halls: z.array(z.object({ name: z.string(), capacity: z.number().int() })),
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
/** Залы: один — просто места, несколько — у каждого название (проверяет normalizeHalls). */
const halls = z
  .array(z.object({ name: z.string().trim().max(60).nullable().optional(), capacity }))
  .min(1)
  .max(5);

export const VenueInput = z
  .object({
    name: text(100),
    address: text(200),
    cityId: z.number().int().positive(),
    /** Мест — если зал один; иначе halls. */
    capacity: capacity.optional(),
    halls: halls.optional(),
    kind: VenueKind,
    /** Сайт — по желанию; без https:// — добавится. */
    website: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => v.capacity !== undefined || v.halls !== undefined, {
    message: 'Укажите, сколько мест',
    path: ['capacity'],
  });
export type VenueInput = z.infer<typeof VenueInput>;

export const VenuePatch = z.object({
  capacity: capacity.optional(),
  halls: halls.optional(),
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
