// Местное время площадки ↔ UTC. Событие вводится и показывается по таймзоне площадки.
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const LOCAL_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

/** `2026-11-06T20:00` по таймзоне tz → момент UTC. */
export function localToUtc(local: string, tz: string): Date {
  const m = LOCAL_RE.exec(local);
  if (!m) throw new Error(`invalid local datetime: ${local}`);
  return fromZonedTime(`${m[1]}T${m[2]}:00`, tz);
}

/** Момент → `2026-11-06T20:00` по таймзоне tz. */
export function utcToLocal(at: Date, tz: string): string {
  return formatInTimeZone(at, tz, "yyyy-MM-dd'T'HH:mm");
}

/**
 * Сдвиг на N календарных дней с сохранением местного времени
 * (копия события «через неделю» остаётся в 20:00, даже если между датами сменилось смещение).
 */
export function shiftLocalDays(at: Date, days: number, tz: string): Date {
  const [date, time] = utcToLocal(at, tz).split('T') as [string, string];
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, mo - 1, d + days));
  return localToUtc(`${shifted.toISOString().slice(0, 10)}T${time}`, tz);
}
