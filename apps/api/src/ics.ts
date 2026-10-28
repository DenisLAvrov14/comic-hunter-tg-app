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

export interface IcsManualGig {
  id: string;
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
export function buildIcs(p: { timezone: string; gigs: IcsGig[]; manual: IcsManualGig[] }): string {
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
  for (const m of p.manual) {
    cal.createEvent({
      id: `busy-${m.id}@standupcalendar`,
      sequence: sequence(m.createdAt),
      start: m.startsAt,
      end: m.endsAt,
      summary: t.manual(m.title ?? t.manualDefault),
      location: m.venueText ?? undefined,
      status: ICalEventStatus.CONFIRMED,
    });
  }
  return cal.toString();
}
