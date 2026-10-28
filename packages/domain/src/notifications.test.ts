import { describe, expect, it } from 'vitest';
import {
  dedupeKey,
  isValidTime,
  localDate,
  noticesForTransition,
  planDayNotifications,
  retryDelayMs,
  zonedDateTime,
  type DayScheduleInput,
} from './notifications';

const at = (iso: string) => new Date(iso);

function plan(input: Partial<DayScheduleInput> & Pick<DayScheduleInput, 'eventStartsAt'>) {
  const res = planDayNotifications({
    stageStartsAt: input.eventStartsAt,
    timezone: 'Europe/Moscow',
    now: at('2026-11-01T00:00:00Z'),
    ...input,
  });
  return {
    date: res.date,
    list: res.notifications.map((n) => [n.kind, n.sendAt.toISOString(), n.audience]),
  };
}

describe('planDayNotifications', () => {
  it('Москва: дайджест 10:00, повтор 12:00, алерт за 3 часа, напоминание за 30 минут', () => {
    // Шоу 20:00 МСК = 17:00 UTC, выход 20:18 МСК.
    const res = plan({
      eventStartsAt: at('2026-11-06T17:00:00Z'),
      stageStartsAt: at('2026-11-06T17:18:00Z'),
    });
    expect(res.date).toBe('2026-11-06');
    expect(res.list).toEqual([
      ['day_digest', '2026-11-06T07:00:00.000Z', 'comedian'],
      ['day_digest_repeat', '2026-11-06T09:00:00.000Z', 'comedian'],
      ['unconfirmed_alert', '2026-11-06T14:00:00.000Z', 'event_staff'],
      ['pre_show_reminder', '2026-11-06T16:48:00.000Z', 'comedian'],
    ]);
  });

  it.each([
    ['Europe/Kaliningrad', '2026-11-06T08:00:00.000Z'], // UTC+2
    ['Europe/Moscow', '2026-11-06T07:00:00.000Z'], // UTC+3
    ['Asia/Almaty', '2026-11-06T05:00:00.000Z'], // UTC+5 с 2024
    ['Asia/Novosibirsk', '2026-11-06T03:00:00.000Z'], // UTC+7
    ['Asia/Vladivostok', '2026-11-06T00:00:00.000Z'], // UTC+10
  ])('%s: дайджест в 10:00 местного', (timezone, digestUtc) => {
    // Шоу в 19:00 местного — через 9 часов после дайджеста.
    const eventStartsAt = new Date(at(digestUtc).getTime() + 9 * 3_600_000);
    const res = plan({ eventStartsAt, timezone });
    expect(res.date).toBe('2026-11-06');
    expect(res.list[0]).toEqual(['day_digest', digestUtc, 'comedian']);
  });

  it('день выступления — по таймзоне комика: шоу 01:00 по Владивостоку — это его «завтра» в UTC', () => {
    // 2026-11-06 15:00 UTC = 2026-11-07 01:00 во Владивостоке.
    const res = plan({ eventStartsAt: at('2026-11-06T15:00:00Z'), timezone: 'Asia/Vladivostok' });
    expect(res.date).toBe('2026-11-07');
    // Дайджест 7 ноября в 10:00 — уже после начала шоу, поэтому дайджеста нет.
    expect(res.list.map((n) => n[0])).toEqual(['pre_show_reminder']);
  });

  it('шоу в 23:50 с выходом после полуночи — дайджест в день начала шоу', () => {
    const res = plan({
      eventStartsAt: at('2026-11-06T20:50:00Z'), // 23:50 МСК
      stageStartsAt: at('2026-11-06T21:10:00Z'), // 00:10 МСК следующего дня
    });
    expect(res.date).toBe('2026-11-06');
    expect(res.list[0]).toEqual(['day_digest', '2026-11-06T07:00:00.000Z', 'comedian']);
    expect(res.list.at(-1)).toEqual(['pre_show_reminder', '2026-11-06T20:40:00.000Z', 'comedian']);
  });

  it('приняли после времени дайджеста — дайджест сразу', () => {
    const now = at('2026-11-06T12:34:00Z');
    const res = plan({ eventStartsAt: at('2026-11-06T17:00:00Z'), now });
    expect(res.list).toEqual([
      ['day_digest', '2026-11-06T12:34:00.000Z', 'comedian'],
      // Алерт не раньше чем через час после дайджеста.
      ['unconfirmed_alert', '2026-11-06T14:00:00.000Z', 'event_staff'],
      ['day_digest_repeat', '2026-11-06T14:34:00.000Z', 'comedian'],
      ['pre_show_reminder', '2026-11-06T16:30:00.000Z', 'comedian'],
    ]);
  });

  it('приняли за час до шоу — алерт сдвигается, повтор после начала не планируется', () => {
    const now = at('2026-11-06T16:00:00Z');
    const res = plan({ eventStartsAt: at('2026-11-06T17:00:00Z'), now });
    expect(res.list).toEqual([
      ['day_digest', '2026-11-06T16:00:00.000Z', 'comedian'],
      ['pre_show_reminder', '2026-11-06T16:30:00.000Z', 'comedian'],
    ]);
  });

  it('шоу уже началось — ничего, кроме напоминания о позднем выходе', () => {
    const res = plan({
      eventStartsAt: at('2026-11-06T17:00:00Z'),
      stageStartsAt: at('2026-11-06T18:00:00Z'),
      now: at('2026-11-06T17:10:00Z'),
    });
    expect(res.list).toEqual([['pre_show_reminder', '2026-11-06T17:30:00.000Z', 'comedian']]);
  });

  it('свои настройки: дайджест 09:30, напоминание за 60 минут', () => {
    const res = plan({
      eventStartsAt: at('2026-11-06T17:00:00Z'),
      digestTime: '09:30',
      preShowMinutes: 60,
    });
    expect(res.list[0]![1]).toBe('2026-11-06T06:30:00.000Z');
    expect(res.list.at(-1)).toEqual(['pre_show_reminder', '2026-11-06T16:00:00.000Z', 'comedian']);
  });

  it('напоминание выключено', () => {
    const res = plan({ eventStartsAt: at('2026-11-06T17:00:00Z'), preShowMinutes: null });
    expect(res.list.map((n) => n[0])).not.toContain('pre_show_reminder');
  });

  it('утреннее шоу раньше дайджеста — дайджеста нет', () => {
    const res = plan({ eventStartsAt: at('2026-11-06T06:00:00Z') }); // 09:00 МСК
    expect(res.list.map((n) => n[0])).toEqual(['pre_show_reminder']);
  });

  it('перенос события на час переносит уведомления, привязанные к началу', () => {
    const before = plan({ eventStartsAt: at('2026-11-06T17:00:00Z') });
    const after = plan({ eventStartsAt: at('2026-11-06T18:00:00Z') });
    const byKind = (r: typeof before) => Object.fromEntries(r.list.map((n) => [n[0], n[1]]));
    expect(byKind(after).unconfirmed_alert).toBe('2026-11-06T15:00:00.000Z');
    expect(byKind(after).pre_show_reminder).toBe('2026-11-06T17:30:00.000Z');
    expect(byKind(after).day_digest).toBe(byKind(before).day_digest);
  });
});

describe('время и таймзоны', () => {
  it('zonedDateTime', () => {
    expect(zonedDateTime('2026-11-06', '10:00', 'Asia/Novosibirsk').toISOString()).toBe(
      '2026-11-06T03:00:00.000Z',
    );
  });

  it('localDate', () => {
    expect(localDate(at('2026-11-06T22:30:00Z'), 'Europe/Moscow')).toBe('2026-11-07');
    expect(localDate(at('2026-11-06T22:30:00Z'), 'Europe/Kaliningrad')).toBe('2026-11-07');
    expect(localDate(at('2026-11-06T21:30:00Z'), 'Europe/Kaliningrad')).toBe('2026-11-06');
  });

  it.each([
    ['10:00', true],
    ['00:00', true],
    ['23:59', true],
    ['24:00', false],
    ['9:00', false],
    ['10:60', false],
    ['', false],
  ])('isValidTime(%j) = %s', (value, ok) => {
    expect(isValidTime(value)).toBe(ok);
  });
});

describe('dedupeKey', () => {
  it('дайджест — один на комика в день', () => {
    expect(dedupeKey('day_digest', { userId: 'u1', date: '2026-11-06' })).toBe(
      'day_digest:u1:2026-11-06',
    );
    expect(dedupeKey('day_digest_repeat', { userId: 'u1', date: '2026-11-06' })).toBe(
      'day_digest_repeat:u1:2026-11-06',
    );
  });
  it('остальные — по участию', () => {
    expect(dedupeKey('pre_show_reminder', { userId: 'u1', participationId: 'p1' })).toBe(
      'pre_show_reminder:u1:p1',
    );
    expect(dedupeKey('event_cancelled', { userId: 'u1' })).toBe('event_cancelled:u1:');
  });
});

describe('retryDelayMs', () => {
  it('экспоненциально растёт и упирается в потолок', () => {
    expect(retryDelayMs(1)).toBe(5_000);
    expect(retryDelayMs(2)).toBe(10_000);
    expect(retryDelayMs(3)).toBe(20_000);
    expect(retryDelayMs(20)).toBe(600_000);
    expect(retryDelayMs(0)).toBe(5_000);
  });
});

describe('noticesForTransition', () => {
  const n = (
    from: Parameters<typeof noticesForTransition>[0]['from'],
    to: Parameters<typeof noticesForTransition>[0]['to'],
    action: Parameters<typeof noticesForTransition>[0]['action'],
    actor: 'comedian' | 'organizer',
  ) => noticesForTransition({ from, to, action, actor }).map((x) => `${x.kind}→${x.audience}`);

  it.each([
    [null, 'pending', 'apply', 'comedian', ['new_application→organizer']],
    [null, 'invited', 'invite', 'organizer', ['invitation_received→comedian']],
    ['pending', 'accepted', 'accept', 'organizer', ['application_accepted→comedian']],
    ['pending', 'rejected', 'reject', 'organizer', ['application_rejected→comedian']],
    ['pending', 'reserve', 'reserve', 'organizer', ['moved_to_reserve→comedian']],
    ['accepted', 'reserve', 'reserve', 'organizer', ['moved_to_reserve→comedian']],
    ['reserve', 'accepted', 'promote', 'organizer', ['promoted_from_reserve→comedian']],
    ['accepted', 'removed', 'remove', 'organizer', ['removed_from_lineup→comedian']],
    ['counter_proposed', 'accepted', 'accept', 'organizer', ['application_accepted→comedian']],
    ['counter_proposed', 'declined', 'reject', 'organizer', ['application_rejected→comedian']],
    [
      'invited',
      'counter_proposed',
      'counter_propose',
      'comedian',
      ['counter_proposal_received→organizer'],
    ],
    ['accepted', 'withdrawn', 'withdraw', 'comedian', ['withdrawal_alert→event_staff']],
    // Реакции самого комика без последствий для состава — без уведомлений.
    ['invited', 'accepted', 'accept', 'comedian', []],
    ['invited', 'declined', 'decline', 'comedian', []],
    ['pending', 'withdrawn', 'withdraw', 'comedian', []],
    ['reserve', 'accepted', 'accept', 'comedian', []],
    ['pending', 'pending', 'accept', 'organizer', []],
  ] as const)('%s → %s (%s, %s)', (from, to, action, actor, expected) => {
    expect(n(from, to, action, actor)).toEqual(expected);
  });
});
