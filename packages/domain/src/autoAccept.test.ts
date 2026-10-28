import { describe, expect, it } from 'vitest';
import { checkRule, inWindow, type AutoAcceptRule } from './autoAccept';

const any: AutoAcceptRule = {
  enabled: true,
  formats: null,
  weekdays: null,
  timeFrom: null,
  timeTo: null,
  maxGigsPerDay: null,
};
// Пятница 6 ноября 2026, 20:00 по Москве.
const friday = {
  format: 'open_mic' as const,
  startsAt: new Date('2026-11-06T17:00:00Z'),
  timezone: 'Europe/Moscow',
};

describe('checkRule', () => {
  it('правило без ограничений принимает', () => {
    expect(checkRule(any, friday, 5)).toEqual({ ok: true });
  });

  it('выключенное правило', () => {
    expect(checkRule({ ...any, enabled: false }, friday, 0)).toEqual({
      ok: false,
      reason: 'disabled',
    });
  });

  it('формат', () => {
    expect(checkRule({ ...any, formats: ['showcase', 'concert'] }, friday, 0)).toEqual({
      ok: false,
      reason: 'format',
    });
    expect(checkRule({ ...any, formats: ['open_mic'] }, friday, 0).ok).toBe(true);
  });

  it('день недели по таймзоне площадки', () => {
    expect(checkRule({ ...any, weekdays: [5] }, friday, 0).ok).toBe(true);
    expect(checkRule({ ...any, weekdays: [6, 7] }, friday, 0)).toEqual({
      ok: false,
      reason: 'weekday',
    });
    // 23:30 пятницы по UTC — уже суббота во Владивостоке.
    const lateUtc = {
      ...friday,
      startsAt: new Date('2026-11-06T23:30:00Z'),
      timezone: 'Asia/Vladivostok',
    };
    expect(checkRule({ ...any, weekdays: [6] }, lateUtc, 0).ok).toBe(true);
  });

  it('окно времени', () => {
    expect(checkRule({ ...any, timeFrom: '19:00', timeTo: '21:00' }, friday, 0).ok).toBe(true);
    expect(checkRule({ ...any, timeFrom: '21:00', timeTo: '23:00' }, friday, 0)).toEqual({
      ok: false,
      reason: 'time_window',
    });
  });

  it('лимит выступлений в день', () => {
    expect(checkRule({ ...any, maxGigsPerDay: 2 }, friday, 1).ok).toBe(true);
    expect(checkRule({ ...any, maxGigsPerDay: 2 }, friday, 2)).toEqual({
      ok: false,
      reason: 'max_per_day',
    });
  });
});

describe('inWindow', () => {
  it.each([
    ['20:00', null, null, true],
    ['20:00', '19:00', null, true],
    ['18:59', '19:00', null, false],
    ['20:00', null, '20:00', true],
    ['20:01', null, '20:00', false],
    // Через полночь.
    ['23:30', '22:00', '02:00', true],
    ['01:00', '22:00', '02:00', true],
    ['12:00', '22:00', '02:00', false],
  ] as const)('%s в [%s, %s] → %s', (time, from, to, expected) => {
    expect(inWindow(time, from, to)).toBe(expected);
  });
});
