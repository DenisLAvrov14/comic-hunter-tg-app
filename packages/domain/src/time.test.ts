import { describe, expect, it } from 'vitest';
import { localToUtc, shiftLocalDays, utcToLocal } from './time';

describe('localToUtc / utcToLocal', () => {
  it.each([
    ['Europe/Moscow', '2026-11-06T17:00:00.000Z'],
    ['Europe/Kaliningrad', '2026-11-06T18:00:00.000Z'],
    ['Asia/Almaty', '2026-11-06T15:00:00.000Z'],
    ['Asia/Novosibirsk', '2026-11-06T13:00:00.000Z'],
    ['Asia/Vladivostok', '2026-11-06T10:00:00.000Z'],
  ])('20:00 в %s', (tz, utc) => {
    expect(localToUtc('2026-11-06T20:00', tz).toISOString()).toBe(utc);
    expect(utcToLocal(new Date(utc), tz)).toBe('2026-11-06T20:00');
  });

  it('полночь: 00:30 местного — это предыдущий день по UTC', () => {
    expect(localToUtc('2026-11-07T00:30', 'Europe/Moscow').toISOString()).toBe(
      '2026-11-06T21:30:00.000Z',
    );
  });

  it('некорректная строка — ошибка', () => {
    expect(() => localToUtc('2026-11-06 20:00', 'Europe/Moscow')).toThrow();
  });
});

describe('shiftLocalDays', () => {
  it('через неделю в то же местное время', () => {
    const at = localToUtc('2026-11-06T20:00', 'Asia/Almaty');
    expect(utcToLocal(shiftLocalDays(at, 7, 'Asia/Almaty'), 'Asia/Almaty')).toBe(
      '2026-11-13T20:00',
    );
  });

  it('через границу месяца и года', () => {
    const at = localToUtc('2026-12-29T23:30', 'Europe/Moscow');
    expect(utcToLocal(shiftLocalDays(at, 7, 'Europe/Moscow'), 'Europe/Moscow')).toBe(
      '2027-01-05T23:30',
    );
  });

  it('сохраняет местное время при смене смещения (летнее время в Европе)', () => {
    const at = localToUtc('2026-03-25T20:00', 'Europe/Berlin');
    const next = shiftLocalDays(at, 7, 'Europe/Berlin');
    expect(utcToLocal(next, 'Europe/Berlin')).toBe('2026-04-01T20:00');
    // Смещение изменилось с +1 на +2 — разница в UTC 7 дней минус час.
    expect(next.getTime() - at.getTime()).toBe((7 * 24 - 1) * 3_600_000);
  });
});
