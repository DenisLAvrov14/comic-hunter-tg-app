import { describe, expect, it } from 'vitest';
import { estimateTotalGigs, isValidStartYear } from './experience';

const now = new Date('2026-11-18T12:00:00Z');

describe('estimateTotalGigs', () => {
  it('нет года или частоты — нет оценки', () => {
    expect(estimateTotalGigs(null, 8, now)).toBeNull();
    expect(estimateTotalGigs(2019, null, now)).toBeNull();
  });

  it('округляет вниз до ступеньки', () => {
    // С середины 2019 по ноябрь 2026 — 88 месяцев × 8 = 704 → 500.
    expect(estimateTotalGigs(2019, 8, now)).toBe(500);
    // 88 × 12 = 1056 → 1000.
    expect(estimateTotalGigs(2019, 12, now)).toBe(1000);
  });

  it('совсем мало выступлений — точное число', () => {
    // Начал в этом году: 4 месяца × 2 = 8.
    expect(estimateTotalGigs(2026, 2, now)).toBe(8);
    expect(estimateTotalGigs(2026, 0, now)).toBe(0);
  });

  it('начал в этом году в первой половине — всё равно минимум месяц', () => {
    expect(estimateTotalGigs(2026, 3, new Date('2026-02-01T00:00:00Z'))).toBe(3);
  });

  it('больше последней ступеньки — последняя ступенька', () => {
    expect(estimateTotalGigs(1980, 30, now)).toBe(5000);
  });
});

describe('isValidStartYear', () => {
  it('принимает годы от 1970 до текущего', () => {
    expect(isValidStartYear(1970, now)).toBe(true);
    expect(isValidStartYear(2026, now)).toBe(true);
    expect(isValidStartYear(1969, now)).toBe(false);
    expect(isValidStartYear(2027, now)).toBe(false);
    expect(isValidStartYear(2020.5, now)).toBe(false);
  });
});
