import { z } from 'zod';
import { ComedianCategory, Photo, ProfileLink } from './profiles';

export const eventFormats = ['open_mic', 'showcase', 'concert', 'other'] as const;
export const EventFormat = z.enum(eventFormats);
export type EventFormat = z.infer<typeof EventFormat>;

export const eventStatuses = [
  'draft',
  'recruiting',
  'lineup_locked',
  'finished',
  'cancelled',
] as const;
export const EventStatus = z.enum(eventStatuses);
export type EventStatus = z.infer<typeof EventStatus>;

export const participationStatuses = [
  'pending',
  'invited',
  'counter_proposed',
  'accepted',
  'reserve',
  'rejected',
  'declined',
  'withdrawn',
  'removed',
] as const;
export const ParticipationStatus = z.enum(participationStatuses);
export type ParticipationStatus = z.infer<typeof ParticipationStatus>;

export const ParticipationSource = z.enum(['application', 'link', 'invitation']);
export type ParticipationSource = z.infer<typeof ParticipationSource>;

export const participationActions = [
  'accept',
  'reject',
  'reserve',
  'promote',
  'remove',
  'withdraw',
  'decline',
  'counter_propose',
] as const;
export const ParticipationAction = z.enum(participationActions);
export type ParticipationAction = z.infer<typeof ParticipationAction>;

/** Местное время площадки без зоны: `2026-11-06T20:00`. Сервер переводит в UTC по таймзоне площадки. */
const LocalDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Формат даты: ГГГГ-ММ-ДДTЧЧ:ММ');

const EventFields = z.object({
  venueId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  format: EventFormat,
  formatNote: z.string().trim().max(120).nullable().optional(),
  startsAtLocal: LocalDateTime,
  endsAtLocal: LocalDateTime.nullable().optional(),
  slotsCount: z.number().int().min(1).max(50),
  setMinutes: z.number().int().min(1).max(120),
  gapMinutes: z.number().int().min(0).max(30).default(2),
  conditions: z.string().trim().max(2000).default(''),
  recruitmentOpen: z.boolean().default(false),
  showLineup: z.boolean().default(true),
});

export const EventInput = EventFields.extend({
  /** draft — черновик, recruiting — опубликовано. */
  status: z.enum(['draft', 'recruiting']).default('recruiting'),
});
export type EventInput = z.input<typeof EventInput>;

export const EventPatch = EventFields.partial().extend({
  status: z.enum(['draft', 'recruiting', 'lineup_locked', 'finished']).optional(),
});
export type EventPatch = z.input<typeof EventPatch>;

export const EventsQuery = z.object({
  city: z.coerce.number().int().positive(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  format: EventFormat.optional(),
});
export type EventsQuery = z.infer<typeof EventsQuery>;

export const MyParticipation = z.object({
  id: z.string().uuid(),
  status: ParticipationStatus,
  source: ParticipationSource,
  position: z.number().int().nullable(),
  autoAccepted: z.boolean(),
  isUrgent: z.boolean(),
  counterProposal: z.string().nullable(),
});
export type MyParticipation = z.infer<typeof MyParticipation>;

export const EventSummary = z.object({
  id: z.string().uuid(),
  title: z.string(),
  format: EventFormat,
  formatNote: z.string().nullable(),
  status: EventStatus,
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  /** Конец окна события (ends_at или расчёт по слотам). */
  windowEndsAt: z.string(),
  timezone: z.string(),
  venue: z.object({
    id: z.string().uuid(),
    name: z.string(),
    address: z.string(),
    cityId: z.number(),
  }),
  organizer: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    projectName: z.string().nullable(),
  }),
  slotsCount: z.number().int(),
  acceptedCount: z.number().int(),
  recruitmentOpen: z.boolean(),
});
export type EventSummary = z.infer<typeof EventSummary>;

export const EventDetails = EventSummary.extend({
  setMinutes: z.number().int(),
  gapMinutes: z.number().int(),
  conditions: z.string(),
  showLineup: z.boolean(),
  lineupVersion: z.number().int(),
  /** Права текущего пользователя на событии. */
  viewer: z.object({
    isOrganizer: z.boolean(),
    canApply: z.boolean(),
    participation: MyParticipation.nullable(),
  }),
  /** Токен ссылки набора — только организатору. */
  linkToken: z.string().nullable(),
  /** Состав в порядке выхода, если организатор разрешил показывать. */
  lineup: z.array(z.object({ position: z.number().int(), stageName: z.string() })).nullable(),
});
export type EventDetails = z.infer<typeof EventDetails>;

export const ApplicationRequest = z.object({
  /** Токен ссылки набора, если комик пришёл по ней. */
  token: z.string().max(100).optional(),
  message: z.string().trim().max(500).optional(),
});
export type ApplicationRequest = z.infer<typeof ApplicationRequest>;

export const InvitationsRequest = z.object({
  comedianIds: z.array(z.string().uuid()).min(1).max(50),
  message: z.string().trim().max(500).optional(),
});
export type InvitationsRequest = z.infer<typeof InvitationsRequest>;

export const InvitationsResponse = z.object({
  invited: z.array(z.string().uuid()),
  /** Уже участвуют (активное участие) — повторно не приглашены. */
  skipped: z.array(z.string().uuid()),
});
export type InvitationsResponse = z.infer<typeof InvitationsResponse>;

export const ParticipationActionRequest = z.object({
  action: ParticipationAction,
  payload: z
    .object({
      /** Принять несмотря на пересечение (только организатор). */
      force: z.boolean().optional(),
      /** Текст встречного предложения. */
      text: z.string().trim().min(1).max(500).optional(),
    })
    .optional(),
});
export type ParticipationActionRequest = z.infer<typeof ParticipationActionRequest>;

/** Детали ошибки CONFLICT_SCHEDULE: с чем пересекается. */
export const ScheduleConflict = z.object({
  kind: z.enum(['gig', 'busy', 'manual_gig']),
  title: z.string(),
  venue: z.string().nullable(),
  start: z.string(),
  end: z.string(),
  timezone: z.string(),
});
export type ScheduleConflict = z.infer<typeof ScheduleConflict>;

export const ComedianBrief = z.object({
  id: z.string().uuid(),
  stageName: z.string(),
  category: ComedianCategory,
  contact: z.string(),
  photoUrl: z.string().nullable(),
});
export type ComedianBrief = z.infer<typeof ComedianBrief>;

export const LineupItem = z.object({
  id: z.string().uuid(),
  status: ParticipationStatus,
  source: ParticipationSource,
  position: z.number().int().nullable(),
  autoAccepted: z.boolean(),
  isUrgent: z.boolean(),
  message: z.string().nullable(),
  counterProposal: z.string().nullable(),
  comedian: ComedianBrief,
  /** Примерное время выхода (для accepted с позицией). */
  stageStart: z.string().nullable(),
  /** Пересечения с другими делами комика — для заявок и приглашений. */
  conflicts: z.array(ScheduleConflict),
});
export type LineupItem = z.infer<typeof LineupItem>;

export const Lineup = z.object({
  version: z.number().int(),
  accepted: z.array(LineupItem),
  reserve: z.array(LineupItem),
  applications: z.array(LineupItem),
  invitations: z.array(LineupItem),
  closed: z.array(LineupItem),
});
export type Lineup = z.infer<typeof Lineup>;

export const InboxItem = z.object({
  participation: MyParticipation,
  event: EventSummary,
});
export type InboxItem = z.infer<typeof InboxItem>;

export const Inbox = z.object({
  /** Приглашения, ждущие ответа комика (и встречные предложения, ждущие организатора). */
  invitations: z.array(InboxItem),
  /** Заявки комика и их статусы. */
  applications: z.array(InboxItem),
});
export type Inbox = z.infer<typeof Inbox>;

export const ComediansQuery = z.object({
  q: z.string().trim().max(64).optional(),
  city: z.coerce.number().int().positive().optional(),
  category: ComedianCategory.optional(),
  /** Только свободные во время этого события. */
  freeAtEvent: z.string().uuid().optional(),
});
export type ComediansQuery = z.infer<typeof ComediansQuery>;

export const ComedianCard = z.object({
  id: z.string().uuid(),
  stageName: z.string(),
  category: ComedianCategory,
  cityId: z.number().int(),
  bio: z.string().nullable(),
  links: z.array(ProfileLink),
  photos: z.array(Photo),
  /** Выступлений через приложение (accepted в прошедших событиях). */
  gigsCount: z.number().int(),
  contact: z.string(),
});
export type ComedianCard = z.infer<typeof ComedianCard>;
