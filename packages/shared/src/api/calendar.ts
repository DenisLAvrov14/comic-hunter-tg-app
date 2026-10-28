import { z } from 'zod';
import { EventFormat } from './events';

const LocalDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Формат даты: ГГГГ-ММ-ДДTЧЧ:ММ');
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Формат времени: ЧЧ:ММ');

export const CalendarQuery = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
});

export const CalendarGig = z.object({
  type: z.literal('gig'),
  participationId: z.string().uuid(),
  eventId: z.string().uuid(),
  title: z.string(),
  venue: z.string(),
  address: z.string(),
  timezone: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  position: z.number().int().nullable(),
  /** Примерное окно на сцене. */
  stageStart: z.string(),
  stageEnd: z.string(),
  dayConfirmation: z.enum(['none', 'confirmed', 'declined']),
  autoAccepted: z.boolean(),
});
export type CalendarGig = z.infer<typeof CalendarGig>;

export const BusySlotKind = z.enum(['busy', 'manual_gig']);

export const CalendarBusy = z.object({
  type: BusySlotKind,
  id: z.string().uuid(),
  title: z.string().nullable(),
  venueText: z.string().nullable(),
  startsAt: z.string(),
  endsAt: z.string(),
});
export type CalendarBusy = z.infer<typeof CalendarBusy>;

export const CalendarResponse = z.object({
  timezone: z.string(),
  items: z.array(z.union([CalendarGig, CalendarBusy])),
});
export type CalendarResponse = z.infer<typeof CalendarResponse>;

/** Время — по таймзоне пользователя. */
export const BusySlotInput = z.object({
  kind: BusySlotKind,
  startsAtLocal: LocalDateTime,
  endsAtLocal: LocalDateTime,
  title: z.string().trim().max(120).nullable().optional(),
  venueText: z.string().trim().max(200).nullable().optional(),
});
export type BusySlotInput = z.infer<typeof BusySlotInput>;

export const AutoAcceptRuleInput = z.object({
  enabled: z.boolean().default(true),
  formats: z.array(EventFormat).min(1).nullable().default(null),
  /** ISO 1 (пн) … 7 (вс). */
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).nullable().default(null),
  timeFrom: Time.nullable().default(null),
  timeTo: Time.nullable().default(null),
  maxGigsPerDay: z.number().int().min(1).max(10).nullable().default(null),
});
export type AutoAcceptRuleInput = z.input<typeof AutoAcceptRuleInput>;

export const AutoAcceptRule = z.object({
  organizerId: z.string().uuid(),
  organizerName: z.string(),
  projectName: z.string().nullable(),
  enabled: z.boolean(),
  formats: z.array(EventFormat).nullable(),
  weekdays: z.array(z.number().int()).nullable(),
  timeFrom: z.string().nullable(),
  timeTo: z.string().nullable(),
  maxGigsPerDay: z.number().int().nullable(),
});
export type AutoAcceptRule = z.infer<typeof AutoAcceptRule>;

export const OrganizerCandidate = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  projectName: z.string().nullable(),
});
export type OrganizerCandidate = z.infer<typeof OrganizerCandidate>;

export const CalendarFeed = z.object({
  /** https-ссылка для Google Calendar («Добавить по URL»). */
  url: z.string(),
  /** webcal:// — подписка в один тап на iPhone. */
  webcalUrl: z.string(),
});
export type CalendarFeed = z.infer<typeof CalendarFeed>;

export const TelegramChatView = z.object({
  id: z.string().uuid(),
  title: z.string(),
  type: z.string(),
  botCanPost: z.boolean(),
});
export type TelegramChatView = z.infer<typeof TelegramChatView>;

export const EventPost = z.object({
  chatId: z.string().uuid(),
  title: z.string(),
  messageId: z.number().int(),
});
export type EventPost = z.infer<typeof EventPost>;

export const PublishPostsResponse = z.object({
  published: z.array(z.string().uuid()),
  failed: z.array(z.string().uuid()),
  posts: z.array(EventPost),
});
export type PublishPostsResponse = z.infer<typeof PublishPostsResponse>;
