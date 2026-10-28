// Расписание уведомлений дня выступления (SPEC §6.4). Чистые функции: время «сейчас»
// передаётся параметром, таймзоны — через date-fns-tz.
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { ParticipationAction, ParticipationActor, ParticipationStatus } from './participation';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const notificationKinds = [
  'invitation_received',
  'invitation_auto_accepted',
  'application_accepted',
  'application_rejected',
  'moved_to_reserve',
  'promoted_from_reserve',
  'removed_from_lineup',
  'event_changed',
  'event_cancelled',
  'lineup_position_changed',
  'day_digest',
  'day_digest_repeat',
  'unconfirmed_alert',
  'withdrawal_alert',
  'pre_show_reminder',
  'replacement_request',
  'counter_proposal_received',
  'new_application',
  'broadcast',
] as const;
export type NotificationKind = (typeof notificationKinds)[number];

export const DEFAULT_DIGEST_TIME = '10:00';
export const DEFAULT_PRE_SHOW_MINUTES = 30;
export const DIGEST_REPEAT_AFTER_MINUTES = 120;
export const UNCONFIRMED_ALERT_BEFORE_MINUTES = 180;
/** Агрегация «новая заявка» организатору: не чаще раза в 15 минут на событие. */
export const NEW_APPLICATION_THROTTLE_MINUTES = 15;

export interface DayScheduleInput {
  /** Начало события. */
  eventStartsAt: Date;
  /** Примерный выход комика на сцену (окно из computeSlotWindows). */
  stageStartsAt: Date;
  /** IANA-таймзона комика — по ней считаются день выступления и время дайджеста. */
  timezone: string;
  /** Время дайджеста «HH:mm» по таймзоне комика. */
  digestTime?: string;
  /** За сколько минут до выхода напомнить; null — напоминание выключено. */
  preShowMinutes?: number | null;
  now: Date;
}

export interface PlannedNotification {
  kind: 'day_digest' | 'day_digest_repeat' | 'unconfirmed_alert' | 'pre_show_reminder';
  sendAt: Date;
  /** Кому: комику или организатору и ведущим события. */
  audience: 'comedian' | 'event_staff';
}

export interface DaySchedule {
  /** Дата выступления по таймзоне комика, `yyyy-MM-dd` — для dedupe_key дайджеста. */
  date: string;
  notifications: PlannedNotification[];
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** Момент `time` (HH:mm) в дату `date` (yyyy-MM-dd) по таймзоне `tz`. */
export function zonedDateTime(date: string, time: string, tz: string): Date {
  return fromZonedTime(`${date}T${time}:00`, tz);
}

/** Календарная дата момента в таймзоне. */
export function localDate(at: Date, tz: string): string {
  return formatInTimeZone(at, tz, 'yyyy-MM-dd');
}

/**
 * Уведомления дня выступления для одного accepted-участия.
 * - Дайджест в digest_time комика; если это время уже прошло (участника приняли позже) —
 *   сразу. Один на комика в день — дедупликация по `dedupe_key` с датой из результата.
 * - Повтор через 2 часа после дайджеста (отправитель пропустит, если комик ответил).
 * - Алерт организатору за 3 часа до начала (не раньше дайджеста).
 * - Напоминание за N минут до примерного выхода.
 * Всё, что приходится на момент начала события или позже, не планируется.
 */
export function planDayNotifications(input: DayScheduleInput): DaySchedule {
  const tz = input.timezone;
  // День выступления — по началу события: шоу в 23:50 с выходом в 00:10 — это «сегодня».
  const date = localDate(input.eventStartsAt, tz);
  const start = input.eventStartsAt.getTime();
  const now = input.now.getTime();
  const result: PlannedNotification[] = [];
  const add = (
    kind: PlannedNotification['kind'],
    at: number,
    audience: PlannedNotification['audience'],
  ) => {
    if (at < start) result.push({ kind, sendAt: new Date(at), audience });
  };

  const digestAt = Math.max(
    zonedDateTime(date, input.digestTime ?? DEFAULT_DIGEST_TIME, tz).getTime(),
    now,
  );
  if (digestAt < start) {
    add('day_digest', digestAt, 'comedian');
    add('day_digest_repeat', digestAt + DIGEST_REPEAT_AFTER_MINUTES * MINUTE, 'comedian');
    add(
      'unconfirmed_alert',
      Math.max(start - UNCONFIRMED_ALERT_BEFORE_MINUTES * MINUTE, digestAt + HOUR),
      'event_staff',
    );
  }

  const preShow =
    input.preShowMinutes === undefined ? DEFAULT_PRE_SHOW_MINUTES : input.preShowMinutes;
  if (preShow !== null) {
    const at = input.stageStartsAt.getTime() - preShow * MINUTE;
    // Напоминание о выходе может прийти и после начала события — комик выступает не первым.
    if (at > now && at < input.stageStartsAt.getTime()) {
      result.push({ kind: 'pre_show_reminder', sendAt: new Date(at), audience: 'comedian' });
    }
  }

  result.sort((a, b) => a.sendAt.getTime() - b.sendAt.getTime());
  return { date, notifications: result };
}

/** dedupe_key для scheduled_notifications. */
export function dedupeKey(
  kind: NotificationKind,
  parts: { userId: string; date?: string; participationId?: string },
): string {
  if (kind === 'day_digest' || kind === 'day_digest_repeat') {
    return `${kind}:${parts.userId}:${parts.date}`;
  }
  return `${kind}:${parts.userId}:${parts.participationId ?? ''}`;
}

/** Ретраи отправки: экспоненциальная пауза с потолком. */
export function retryDelayMs(attempt: number, baseMs = 5_000, maxMs = 10 * MINUTE): number {
  return Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs);
}

export interface TransitionNotice {
  kind: NotificationKind;
  /** comedian — участнику; organizer — организатору; event_staff — организатору и ведущим. */
  audience: 'comedian' | 'organizer' | 'event_staff';
}

/**
 * Уведомления, которые порождает переход участия (SPEC §4: «каждый переход порождает
 * уведомление»). Реакции самого получателя (комик принял приглашение) не уведомляются.
 */
export function noticesForTransition(t: {
  from: ParticipationStatus | null;
  to: ParticipationStatus;
  action: ParticipationAction | 'apply' | 'invite';
  actor: ParticipationActor;
}): TransitionNotice[] {
  const toComedian = (kind: NotificationKind): TransitionNotice[] => [
    { kind, audience: 'comedian' },
  ];
  if (t.action === 'apply') return [{ kind: 'new_application', audience: 'organizer' }];
  if (t.action === 'invite') return toComedian('invitation_received');

  if (t.actor === 'organizer') {
    switch (t.to) {
      case 'accepted':
        return toComedian(t.from === 'reserve' ? 'promoted_from_reserve' : 'application_accepted');
      case 'rejected':
      case 'declined':
        return toComedian('application_rejected');
      case 'reserve':
        return toComedian('moved_to_reserve');
      case 'removed':
        // Отозванное приглашение — тоже «убран из состава»: событие для комика закрыто.
        return toComedian('removed_from_lineup');
      default:
        return [];
    }
  }
  if (t.to === 'counter_proposed')
    return [{ kind: 'counter_proposal_received', audience: 'organizer' }];
  if (t.to === 'withdrawn' && t.from === 'accepted') {
    return [{ kind: 'withdrawal_alert', audience: 'event_staff' }];
  }
  return [];
}
