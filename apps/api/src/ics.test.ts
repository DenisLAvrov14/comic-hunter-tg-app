import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { buildFeedPage, buildIcs, type IcsGig } from './ics';

const gig: IcsGig = {
  participationId: '0c65fc41-07bc-409d-8d6a-f3c02487494c',
  title: 'Пятничный open mic',
  venue: 'Подвал',
  address: 'ул. Мясницкая, 13',
  timezone: 'Europe/Moscow',
  startsAt: new Date('2026-11-06T17:00:00Z'),
  endsAt: new Date('2026-11-06T18:00:00Z'),
  position: 3,
  stageStart: new Date('2026-11-06T17:18:00Z'),
  dayConfirmation: 'confirmed',
  cancelled: false,
  updatedAt: new Date('2026-11-01T10:00:00Z'),
};

function parse(text: string) {
  const comp = new ICAL.Component(ICAL.parse(text));
  return { comp, events: comp.getAllSubcomponents('vevent').map((v) => new ICAL.Event(v)) };
}

describe('buildIcs', () => {
  it('валидный календарь: парсится, стабильный UID, весь вечер, описание', () => {
    const text = buildIcs({ timezone: 'Europe/Moscow', gigs: [gig], busy: [] });
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('X-WR-CALNAME:Stand Up Calendar');
    expect(text).toContain('X-WR-TIMEZONE:Europe/Moscow');
    expect(text).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');

    const { events } = parse(text);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.uid).toBe(`participation-${gig.participationId}@standupcalendar`);
    expect(e.summary).toBe('🎤 Пятничный open mic — Подвал');
    expect(e.startDate.toJSDate().toISOString()).toBe('2026-11-06T17:00:00.000Z');
    expect(e.endDate.toJSDate().toISOString()).toBe('2026-11-06T18:00:00.000Z');
    expect(e.description).toBe(
      [
        '№3 в составе',
        'Примерное время выхода: 20:18',
        'Адрес: ул. Мясницкая, 13',
        'Участие: подтверждено',
      ].join('\n'),
    );
    expect(e.component.getFirstPropertyValue('status')).toBe('CONFIRMED');
  });

  it('SEQUENCE растёт при изменении, отменённое — STATUS:CANCELLED', () => {
    const before = parse(buildIcs({ timezone: 'Europe/Moscow', gigs: [gig], busy: [] })).events[0]!;
    const after = parse(
      buildIcs({
        timezone: 'Europe/Moscow',
        gigs: [{ ...gig, cancelled: true, updatedAt: new Date('2026-11-02T10:00:00Z') }],
        busy: [],
      }),
    ).events[0]!;
    expect(after.sequence).toBeGreaterThan(before.sequence);
    expect(after.uid).toBe(before.uid);
    expect(after.component.getFirstPropertyValue('status')).toBe('CANCELLED');
  });

  it('свои выступления и занятость — отдельные события', () => {
    const { events } = parse(
      buildIcs({
        timezone: 'Asia/Almaty',
        gigs: [],
        busy: [
          {
            id: 'b1',
            kind: 'manual_gig',
            title: 'Корпоратив',
            venueText: 'Ресторан',
            startsAt: new Date('2026-11-07T14:00:00Z'),
            endsAt: new Date('2026-11-07T16:00:00Z'),
            createdAt: new Date('2026-11-01T00:00:00Z'),
          },
          {
            id: 'b2',
            kind: 'busy',
            title: 'Репетиция',
            venueText: null,
            startsAt: new Date('2026-11-08T14:00:00Z'),
            endsAt: new Date('2026-11-08T16:00:00Z'),
            createdAt: new Date('2026-11-01T00:00:00Z'),
          },
          {
            id: 'b3',
            kind: 'busy',
            title: null,
            venueText: null,
            startsAt: new Date('2026-11-09T14:00:00Z'),
            endsAt: new Date('2026-11-09T16:00:00Z'),
            createdAt: new Date('2026-11-01T00:00:00Z'),
          },
        ],
      }),
    );
    expect(events.map((e) => [e.uid, e.summary, e.location])).toEqual([
      ['busy-b1@standupcalendar', '🎤 Корпоратив', 'Ресторан'],
      ['busy-b2@standupcalendar', 'Занят: Репетиция', null],
      ['busy-b3@standupcalendar', 'Занят', null],
    ]);
  });

  it('страница подключения ведёт в webcal и в Google', () => {
    const page = buildFeedPage('https://example.test/cal/abc.ics');
    expect(page).toContain('href="webcal://example.test/cal/abc.ics"');
    expect(page).toContain(
      'href="https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fexample.test%2Fcal%2Fabc.ics"',
    );
  });
});
