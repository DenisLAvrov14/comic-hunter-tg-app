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

/** «пт, 6 ноября в 20:00» в таймзоне площадки. */
export function dateTime(at: Date, tz: string): string {
  return fmt(tz, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/** «20:00» */
export function time(at: Date, tz: string): string {
  return fmt(tz, { hour: '2-digit', minute: '2-digit' }).format(at);
}
