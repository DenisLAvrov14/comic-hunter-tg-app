import { describe, expect, it } from 'vitest';
import { MAX_TRIP_DAYS, tripDateError } from './trips';

describe('tripDateError', () => {
  const today = '2026-11-01';

  it('обычная поездка и поездка на один день', () => {
    expect(tripDateError('2026-11-12', '2026-11-14', today)).toBeNull();
    expect(tripDateError('2026-11-12', '2026-11-12', today)).toBeNull();
  });

  it('поездка, которая уже идёт и заканчивается сегодня, допустима', () => {
    expect(tripDateError('2026-10-30', today, today)).toBeNull();
  });

  it('конец раньше начала', () => {
    expect(tripDateError('2026-11-14', '2026-11-12', today)).toBe('end_before_start');
  });

  it('поездка целиком в прошлом', () => {
    expect(tripDateError('2026-10-01', '2026-10-31', today)).toBe('in_past');
  });

  it('граница длины считается по дням включительно', () => {
    expect(MAX_TRIP_DAYS).toBe(60);
    expect(tripDateError('2026-11-01', '2026-12-30', today)).toBeNull();
    expect(tripDateError('2026-11-01', '2026-12-31', today)).toBe('too_long');
  });
});
