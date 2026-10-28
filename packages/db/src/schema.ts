import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Таблицы из раздела 3 ТЗ добавляются по этапам. Этап 2: справочники и профили.
// Этап 4: события, участия, история, штат, занятость.

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const userRoleEnum = pgEnum('user_role', ['comedian', 'organizer', 'host']);
export const countryEnum = pgEnum('country', ['RU', 'KZ']);
export const comedianCategoryEnum = pgEnum('comedian_category', ['newbie', 'experienced', 'media']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  telegramUsername: text('telegram_username'),
  firstName: text('first_name').notNull(),
  lastName: text('last_name'),
  languageCode: text('language_code'),
  // Берётся из города профиля при его сохранении; до этого — Москва.
  timezone: text('timezone').notNull().default('Europe/Moscow'),
  botStarted: boolean('bot_started').notNull().default(false),
  botBlocked: boolean('bot_blocked').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRoleEnum('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const cities = pgTable(
  'cities',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    name: text('name').notNull(),
    country: countryEnum('country').notNull(),
    timezone: text('timezone').notNull(),
  },
  (t) => [uniqueIndex('cities_name_country_uq').on(t.name, t.country)],
);

// Дублирует linkTypes из @standup/shared: db не зависит от shared.
export type ProfileLinkType =
  'video' | 'telegram' | 'instagram' | 'youtube' | 'vk' | 'tiktok' | 'other';

export interface ProfileLink {
  type: ProfileLinkType;
  url: string;
}

export const comedianProfiles = pgTable(
  'comedian_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    stageName: text('stage_name').notNull(),
    cityId: integer('city_id')
      .notNull()
      .references(() => cities.id),
    category: comedianCategoryEnum('category').notNull().default('newbie'),
    categoryVerified: boolean('category_verified').notNull().default(false),
    bio: text('bio'),
    contact: text('contact').notNull(),
    links: jsonb('links').$type<ProfileLink[]>().notNull().default([]),
    travelBufferMinutes: integer('travel_buffer_minutes').notNull().default(30),
    defaultSetMinutes: integer('default_set_minutes'),
    isSearchable: boolean('is_searchable').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('comedian_profiles_city_idx').on(t.cityId)],
);

export const comedianPhotos = pgTable(
  'comedian_photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    s3Key: text('s3_key').notNull(),
    previewS3Key: text('preview_s3_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('comedian_photos_user_idx').on(t.userId)],
);

export const organizerProfiles = pgTable('organizer_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  projectName: text('project_name'),
  cityId: integer('city_id')
    .notNull()
    .references(() => cities.id),
  contact: text('contact'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    address: text('address').notNull(),
    cityId: integer('city_id')
      .notNull()
      .references(() => cities.id),
    timezone: text('timezone').notNull(),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('venues_city_idx').on(t.cityId)],
);

export const eventFormatEnum = pgEnum('event_format', ['open_mic', 'showcase', 'concert', 'other']);
export const eventStatusEnum = pgEnum('event_status', [
  'draft',
  'recruiting',
  'lineup_locked',
  'finished',
  'cancelled',
]);
export const participationSourceEnum = pgEnum('participation_source', [
  'application',
  'link',
  'invitation',
]);
export const participationStatusEnum = pgEnum('participation_status', [
  'pending',
  'invited',
  'counter_proposed',
  'accepted',
  'reserve',
  'rejected',
  'declined',
  'withdrawn',
  'removed',
]);
export const dayConfirmationEnum = pgEnum('day_confirmation', ['none', 'confirmed', 'declined']);
export const attendanceEnum = pgEnum('attendance', ['unknown', 'present', 'absent']);
export const staffRoleEnum = pgEnum('staff_role', ['host']);
export const busyKindEnum = pgEnum('busy_kind', ['busy', 'manual_gig']);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => users.id),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id),
    title: text('title').notNull(),
    format: eventFormatEnum('format').notNull(),
    formatNote: text('format_note'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    // Конец окна события: ends_at или расчёт по слотам (eventWindow из domain).
    // Хранится, чтобы искать пересечения через tstzrange && с GiST-индексом.
    windowEndsAt: timestamp('window_ends_at', { withTimezone: true }).notNull(),
    slotsCount: integer('slots_count').notNull(),
    setMinutes: integer('set_minutes').notNull(),
    gapMinutes: integer('gap_minutes').notNull().default(2),
    conditions: text('conditions').notNull().default(''),
    recruitmentOpen: boolean('recruitment_open').notNull().default(false),
    recruitmentLinkToken: text('recruitment_link_token').unique(),
    // SPEC §14, вопрос 2: видят ли комики состав. По умолчанию — да.
    showLineup: boolean('show_lineup').notNull().default(true),
    status: eventStatusEnum('status').notNull().default('draft'),
    lineupVersion: integer('lineup_version').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('events_organizer_idx').on(t.organizerId, t.startsAt),
    index('events_open_idx').on(t.status, t.recruitmentOpen, t.startsAt),
    index('events_window_gist').using('gist', sql`tstzrange(${t.startsAt}, ${t.windowEndsAt})`),
  ],
);

export const participations = pgTable(
  'participations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    comedianId: uuid('comedian_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: participationSourceEnum('source').notNull(),
    status: participationStatusEnum('status').notNull(),
    position: integer('position'),
    setMinutesOverride: integer('set_minutes_override'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    autoAccepted: boolean('auto_accepted').notNull().default(false),
    // Приглашение на замену выбывшего (этап 5): первый принявший занимает позицию.
    isUrgent: boolean('is_urgent').notNull().default(false),
    // Сопроводительный текст заявки или приглашения.
    message: text('message'),
    counterProposal: text('counter_proposal'),
    dayConfirmation: dayConfirmationEnum('day_confirmation').notNull().default('none'),
    dayConfirmedAt: timestamp('day_confirmed_at', { withTimezone: true }),
    attendance: attendanceEnum('attendance').notNull().default('unknown'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('participations_event_comedian_uq').on(t.eventId, t.comedianId),
    index('participations_comedian_idx').on(t.comedianId, t.status),
    index('participations_event_idx').on(t.eventId, t.status),
  ],
);

export const participationEvents = pgTable(
  'participation_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    participationId: uuid('participation_id')
      .notNull()
      .references(() => participations.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    fromStatus: participationStatusEnum('from_status'),
    toStatus: participationStatusEnum('to_status').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('participation_events_participation_idx').on(t.participationId)],
);

export const eventStaff = pgTable(
  'event_staff',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: staffRoleEnum('role').notNull().default('host'),
    permissions: jsonb('permissions').$type<Record<string, boolean>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);

export const busySlots = pgTable(
  'busy_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    title: text('title'),
    kind: busyKindEnum('kind').notNull(),
    venueText: text('venue_text'),
    createdAt: createdAt(),
  },
  (t) => [
    index('busy_slots_user_idx').on(t.userId),
    index('busy_slots_window_gist').using('gist', sql`tstzrange(${t.startsAt}, ${t.endsAt})`),
  ],
);

export type User = typeof users.$inferSelect;
export type City = typeof cities.$inferSelect;
export type ComedianProfile = typeof comedianProfiles.$inferSelect;
export type ComedianPhoto = typeof comedianPhotos.$inferSelect;
export type OrganizerProfile = typeof organizerProfiles.$inferSelect;
export type Venue = typeof venues.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Participation = typeof participations.$inferSelect;
export type EventStaff = typeof eventStaff.$inferSelect;
export type BusySlot = typeof busySlots.$inferSelect;
