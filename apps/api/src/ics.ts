import ical, { ICalEventStatus } from 'ical-generator';
import { ru } from '@standup/shared';

export interface IcsGig {
  participationId: string;
  title: string;
  venue: string;
  address: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  position: number | null;
  stageStart: Date | null;
  dayConfirmation: 'none' | 'confirmed' | 'declined';
  cancelled: boolean;
  /** Последнее изменение участия или события — из него растёт SEQUENCE. */
  updatedAt: Date;
}

export interface IcsBusySlot {
  id: string;
  kind: 'busy' | 'manual_gig';
  title: string | null;
  venueText: string | null;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
}

const EPOCH = Date.UTC(2024, 0, 1);
/** SEQUENCE растёт при каждом изменении: секунды с 2024 года. */
const sequence = (at: Date) => Math.max(0, Math.floor((at.getTime() - EPOCH) / 1000));

function hhmm(at: Date, tz: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/**
 * ICS-лента комика (SPEC §10). DTSTART — начало события, чтобы в календаре был виден весь вечер;
 * примерное время выхода — в описании. Время в UTC: VTIMEZONE не нужен, клиенты покажут в своей зоне.
 */
export function buildIcs(p: { timezone: string; gigs: IcsGig[]; busy: IcsBusySlot[] }): string {
  const t = ru.ics;
  const cal = ical({
    name: t.calendarName,
    prodId: { company: 'standupcalendar', product: 'feed', language: 'RU' },
    // REFRESH-INTERVAL и X-PUBLISHED-TTL: клиенты могут игнорировать.
    ttl: 60 * 60,
  });
  cal.x('X-WR-TIMEZONE', p.timezone);

  for (const g of p.gigs) {
    const description = [
      g.position ? t.position(g.position) : null,
      g.stageStart ? t.stage(hhmm(g.stageStart, g.timezone)) : null,
      t.address(g.address),
      t.confirmation[g.dayConfirmation],
    ]
      .filter(Boolean)
      .join('\n');
    cal.createEvent({
      id: `participation-${g.participationId}@standupcalendar`,
      sequence: sequence(g.updatedAt),
      start: g.startsAt,
      end: g.endsAt,
      summary: t.summary(g.title, g.venue),
      location: `${g.venue}, ${g.address}`,
      description,
      status: g.cancelled ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
    });
  }
  for (const b of p.busy) {
    cal.createEvent({
      id: `busy-${b.id}@standupcalendar`,
      sequence: sequence(b.createdAt),
      start: b.startsAt,
      end: b.endsAt,
      summary: b.kind === 'busy' ? t.busy(b.title) : t.manual(b.title ?? t.manualDefault),
      location: b.venueText ?? undefined,
      status: ICalEventStatus.CONFIRMED,
    });
  }
  return cal.toString();
}

/**
 * Страница подключения календаря. Telegram открывает только http(s), поэтому Mini App ведёт сюда,
 * а уже отсюда браузер передаёт webcal:// системному календарю.
 */
export function buildFeedPage(url: string): string {
  const t = ru.ics.page;
  const webcal = url.replace(/^https?:\/\//, 'webcal://');
  const google = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${t.title}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; padding: 32px 16px; font: 16px/1.45 -apple-system, system-ui, sans-serif; }
main { max-width: 420px; margin: 0 auto; display: grid; gap: 12px; }
h1 { margin: 0; font-size: 24px; }
p { margin: 0; opacity: .7; font-size: 14px; }
a.button { display: block; padding: 14px; border-radius: 12px; background: #2481cc; color: #fff; text-align: center; text-decoration: none; font-weight: 600; }
code { overflow-wrap: anywhere; font-size: 12px; }
</style>
</head>
<body>
<main>
<h1>${t.title}</h1>
<p>${t.hint}</p>
<a class="button" href="${webcal}">${t.apple}</a>
<a class="button" href="${google}">${t.google}</a>
<p>${t.googleHint}</p>
<p>${t.manual}</p>
<code>${url}</code>
</main>
</body>
</html>
`;
}
