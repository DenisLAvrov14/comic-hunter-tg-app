// Даты событий показываются в таймзоне площадки (SPEC §11).
const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  const key = tz + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, ...opts });
    cache.set(key, f);
  }
  return f;
}

/** «пт, 6 ноября, 20:00» */
export function formatDateTime(iso: string, tz: string): string {
  return fmt(tz, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** «20:00» */
export function formatTime(iso: string, tz: string): string {
  return fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** «20:00–20:07» */
export function formatRange(start: string, end: string, tz: string): string {
  return `${formatTime(start, tz)}–${formatTime(end, tz)}`;
}

/** Части местного времени площадки для формы: { date: '2026-11-06', time: '20:00' }. */
export function toLocalParts(iso: string, tz: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    fmt(tz, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** Сегодня в формате yyyy-MM-dd по таймзоне устройства. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
