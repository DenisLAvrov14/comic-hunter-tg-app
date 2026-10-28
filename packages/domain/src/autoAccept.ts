// Автопринятие приглашений (SPEC §6.2): условия правила доверенного организатора.
// Пересечения и свободное место проверяются отдельно (findConflicts, hasFreeSlot).
import { formatInTimeZone } from 'date-fns-tz';

export type EventFormatValue = 'open_mic' | 'showcase' | 'concert' | 'other';

export interface AutoAcceptRule {
  enabled: boolean;
  /** null — любые форматы. */
  formats: EventFormatValue[] | null;
  /** ISO-дни недели 1 (пн) … 7 (вс); null — любые. */
  weekdays: number[] | null;
  /** Окно начала события «HH:mm», включительно; null — без ограничения. */
  timeFrom: string | null;
  timeTo: string | null;
  maxGigsPerDay: number | null;
}

export type AutoAcceptReason =
  'disabled' | 'format' | 'weekday' | 'time_window' | 'max_per_day' | 'conflict' | 'lineup_full';

export interface AutoAcceptEvent {
  format: EventFormatValue;
  startsAt: Date;
  /** Таймзона площадки: день недели и окно — по местному времени события. */
  timezone: string;
}

/**
 * Проверка условий правила. `gigsThatDay` — сколько у комика уже принятых выступлений
 * в этот же местный день.
 */
export function checkRule(
  rule: AutoAcceptRule,
  event: AutoAcceptEvent,
  gigsThatDay: number,
): { ok: true } | { ok: false; reason: AutoAcceptReason } {
  if (!rule.enabled) return { ok: false, reason: 'disabled' };
  if (rule.formats && !rule.formats.includes(event.format)) return { ok: false, reason: 'format' };

  const weekday = Number(formatInTimeZone(event.startsAt, event.timezone, 'i'));
  if (rule.weekdays && !rule.weekdays.includes(weekday)) return { ok: false, reason: 'weekday' };

  const time = formatInTimeZone(event.startsAt, event.timezone, 'HH:mm');
  if (!inWindow(time, rule.timeFrom, rule.timeTo)) return { ok: false, reason: 'time_window' };

  if (rule.maxGigsPerDay !== null && gigsThatDay >= rule.maxGigsPerDay) {
    return { ok: false, reason: 'max_per_day' };
  }
  return { ok: true };
}

/** Окно может переходить через полночь: 22:00–02:00. */
export function inWindow(time: string, from: string | null, to: string | null): boolean {
  if (from === null && to === null) return true;
  if (from !== null && to !== null && from > to) return time >= from || time <= to;
  return (from === null || time >= from) && (to === null || time <= to);
}
