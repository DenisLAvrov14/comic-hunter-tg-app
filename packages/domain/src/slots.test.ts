import { describe, expect, it } from 'vitest';
import {
  computeSlotWindows,
  eventWindow,
  expand,
  findConflicts,
  overlaps,
  type Commitment,
  type EventTiming,
  type Window,
} from './slots';

const at = (iso: string) => new Date(iso);
const win = (start: string, end: string): Window => ({ start: at(start), end: at(end) });
const iso = (w: Window | undefined) => w && [w.start.toISOString(), w.end.toISOString()];

// 20:00 по Москве = 17:00 UTC.
const show: EventTiming = {
  startsAt: at('2026-11-06T17:00:00Z'),
  endsAt: null,
  slotsCount: 4,
  setMinutes: 7,
  gapMinutes: 2,
};

describe('eventWindow', () => {
  it('без ends_at — слоты × (сет + пауза)', () => {
    expect(iso(eventWindow(show))).toEqual([
      '2026-11-06T17:00:00.000Z',
      '2026-11-06T17:36:00.000Z',
    ]);
  });
  it('с ends_at — как задано', () => {
    expect(iso(eventWindow({ ...show, endsAt: at('2026-11-06T19:00:00Z') }))).toEqual([
      '2026-11-06T17:00:00.000Z',
      '2026-11-06T19:00:00.000Z',
    ]);
  });
});

describe('computeSlotWindows', () => {
  it('считает окна по позициям, а не по порядку в массиве', () => {
    const w = computeSlotWindows(show, [
      { id: 'c', position: 3, setMinutesOverride: null },
      { id: 'a', position: 1, setMinutesOverride: null },
      { id: 'b', position: 2, setMinutesOverride: 10 },
    ]);
    expect(iso(w.get('a'))).toEqual(['2026-11-06T17:00:00.000Z', '2026-11-06T17:07:00.000Z']);
    // a: 7 + 2
    expect(iso(w.get('b'))).toEqual(['2026-11-06T17:09:00.000Z', '2026-11-06T17:19:00.000Z']);
    // a: 7 + 2, b: 10 + 2
    expect(iso(w.get('c'))).toEqual(['2026-11-06T17:21:00.000Z', '2026-11-06T17:28:00.000Z']);
  });

  it('пропуск в позициях не создаёт дыру — считаются только предыдущие участники', () => {
    const w = computeSlotWindows(show, [
      { id: 'a', position: 1, setMinutesOverride: null },
      { id: 'b', position: 5, setMinutesOverride: null },
    ]);
    expect(iso(w.get('b'))).toEqual(['2026-11-06T17:09:00.000Z', '2026-11-06T17:16:00.000Z']);
  });

  it('без позиции — окно всего события', () => {
    const w = computeSlotWindows(show, [
      { id: 'a', position: 1, setMinutesOverride: null },
      { id: 'p', position: null, setMinutesOverride: null },
    ]);
    expect(iso(w.get('p'))).toEqual(iso(eventWindow(show)));
  });

  it('событие без позиций вообще', () => {
    const w = computeSlotWindows(show, [
      { id: 'x', position: null, setMinutesOverride: null },
      { id: 'y', position: null, setMinutesOverride: null },
    ]);
    expect(iso(w.get('x'))).toEqual(iso(eventWindow(show)));
    expect(iso(w.get('y'))).toEqual(iso(eventWindow(show)));
  });

  it('переход через полночь по местному времени', () => {
    // 23:50 по Москве = 20:50 UTC; второй комик выходит после полуночи.
    const late: EventTiming = { ...show, startsAt: at('2026-11-06T20:50:00Z') };
    const w = computeSlotWindows(late, [
      { id: 'a', position: 1, setMinutesOverride: 15 },
      { id: 'b', position: 2, setMinutesOverride: null },
    ]);
    expect(iso(w.get('b'))).toEqual(['2026-11-06T21:07:00.000Z', '2026-11-06T21:14:00.000Z']);
  });
});

describe('overlaps / expand', () => {
  it('касание концами — не пересечение', () => {
    expect(
      overlaps(
        win('2026-11-06T17:00Z', '2026-11-06T17:10Z'),
        win('2026-11-06T17:10Z', '2026-11-06T17:20Z'),
      ),
    ).toBe(false);
  });
  it('пересечение на минуту', () => {
    expect(
      overlaps(
        win('2026-11-06T17:00Z', '2026-11-06T17:11Z'),
        win('2026-11-06T17:10Z', '2026-11-06T17:20Z'),
      ),
    ).toBe(true);
  });
  it('вложенность', () => {
    expect(
      overlaps(
        win('2026-11-06T17:00Z', '2026-11-06T18:00Z'),
        win('2026-11-06T17:10Z', '2026-11-06T17:20Z'),
      ),
    ).toBe(true);
  });
  it('expand расширяет в обе стороны', () => {
    expect(iso(expand(win('2026-11-06T17:00Z', '2026-11-06T17:10Z'), 30))).toEqual([
      '2026-11-06T16:30:00.000Z',
      '2026-11-06T17:40:00.000Z',
    ]);
  });
});

describe('findConflicts', () => {
  // Выход 20:00–20:07 по Москве.
  const candidate = win('2026-11-06T17:00Z', '2026-11-06T17:07Z');
  const gig = (start: string, end: string, ref: string): Commitment<string> => ({
    window: win(start, end),
    kind: 'gig',
    ref,
  });

  it('нет дел — нет конфликтов', () => {
    expect(findConflicts(candidate, 30, [])).toEqual([]);
  });

  it('другое выступление ближе буфера — конфликт', () => {
    // Выход в другом месте в 20:30: между концом (20:07) и началом 23 минуты < 30.
    const res = findConflicts(candidate, 30, [
      gig('2026-11-06T17:30Z', '2026-11-06T17:37Z', 'podval'),
    ]);
    expect(res.map((c) => c.ref)).toEqual(['podval']);
    expect(iso(res[0]!.window)).toEqual(['2026-11-06T17:30:00.000Z', '2026-11-06T17:37:00.000Z']);
  });

  it('другое выступление ровно через буфер — не конфликт', () => {
    expect(
      findConflicts(candidate, 30, [gig('2026-11-06T17:37Z', '2026-11-06T17:44Z', 'x')]),
    ).toEqual([]);
  });

  it('буфер 0 — только прямое пересечение', () => {
    expect(
      findConflicts(candidate, 0, [gig('2026-11-06T17:07Z', '2026-11-06T17:14Z', 'x')]),
    ).toEqual([]);
    expect(
      findConflicts(candidate, 0, [gig('2026-11-06T17:06Z', '2026-11-06T17:14Z', 'x')]),
    ).toHaveLength(1);
  });

  it('busy — без буфера, manual_gig — с буфером', () => {
    const near = win('2026-11-06T17:20Z', '2026-11-06T18:00Z');
    expect(findConflicts(candidate, 30, [{ window: near, kind: 'busy', ref: 'busy' }])).toEqual([]);
    expect(
      findConflicts(candidate, 30, [{ window: near, kind: 'manual_gig', ref: 'manual' }]).map(
        (c) => c.ref,
      ),
    ).toEqual(['manual']);
    const overlapping = win('2026-11-06T17:05Z', '2026-11-06T18:00Z');
    expect(
      findConflicts(candidate, 30, [{ window: overlapping, kind: 'busy', ref: 'busy' }]),
    ).toHaveLength(1);
  });

  it('несколько конфликтов — по времени', () => {
    const res = findConflicts(candidate, 30, [
      gig('2026-11-06T17:20Z', '2026-11-06T17:27Z', 'later'),
      gig('2026-11-06T16:40Z', '2026-11-06T16:47Z', 'earlier'),
      gig('2026-11-06T20:00Z', '2026-11-06T20:07Z', 'far'),
    ]);
    expect(res.map((c) => c.ref)).toEqual(['earlier', 'later']);
  });

  it('выступление без позиции занимает весь вечер', () => {
    const whole = eventWindow({ ...show, startsAt: at('2026-11-06T16:00Z') });
    expect(
      findConflicts(candidate, 30, [{ window: whole, kind: 'gig', ref: 'whole' }]),
    ).toHaveLength(1);
  });

  it('разные таймзоны площадок: сравнение по абсолютному времени', () => {
    // Алматы 22:00 (UTC+5) = 17:00 UTC = 20:00 Москва — тот же момент, что и candidate.
    const almaty = gig('2026-11-06T17:00:00+05:00', '2026-11-06T17:07:00+05:00', 'almaty-17-local');
    expect(findConflicts(candidate, 30, [almaty])).toEqual([]);
    const almatyEvening = gig(
      '2026-11-06T22:00:00+05:00',
      '2026-11-06T22:07:00+05:00',
      'almaty-22-local',
    );
    expect(findConflicts(candidate, 30, [almatyEvening]).map((c) => c.ref)).toEqual([
      'almaty-22-local',
    ]);
  });

  it('конфликт через полночь', () => {
    const lateCandidate = win('2026-11-06T20:55Z', '2026-11-06T21:05Z'); // 23:55–00:05 МСК
    const afterMidnight = gig('2026-11-06T21:20Z', '2026-11-06T21:27Z', 'after'); // 00:20 МСК
    expect(findConflicts(lateCandidate, 30, [afterMidnight]).map((c) => c.ref)).toEqual(['after']);
  });
});
