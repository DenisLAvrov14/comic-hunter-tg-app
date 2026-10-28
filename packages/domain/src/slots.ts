// Окна выступлений и пересечения (SPEC §6.1). Время — абсолютное (Date, UTC),
// поэтому переход через полночь и таймзоны площадок на расчёт не влияют.

const MINUTE = 60_000;

/** Полуоткрытый интервал [start, end). */
export interface Window {
  start: Date;
  end: Date;
}

export interface EventTiming {
  startsAt: Date;
  endsAt: Date | null;
  slotsCount: number;
  setMinutes: number;
  gapMinutes: number;
}

export interface LineupEntry {
  id: string;
  /** Позиция в составе; null — порядок не задан или участие не accepted. */
  position: number | null;
  setMinutesOverride: number | null;
}

const addMinutes = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MINUTE);

/** Всё событие: [starts_at, ends_at ?? starts_at + slots × (set + gap)]. */
export function eventWindow(e: EventTiming): Window {
  return {
    start: e.startsAt,
    end: e.endsAt ?? addMinutes(e.startsAt, e.slotsCount * (e.setMinutes + e.gapMinutes)),
  };
}

/**
 * Примерное окно на сцене для каждого участника:
 * start_i = starts_at + Σ (set_j + gap) по всем j с position < i, end_i = start_i + set_i.
 * Участники без позиции получают окно всего события.
 */
export function computeSlotWindows(
  event: EventTiming,
  entries: readonly LineupEntry[],
): Map<string, Window> {
  const result = new Map<string, Window>();
  const whole = eventWindow(event);
  const ordered = entries
    .filter((e): e is LineupEntry & { position: number } => e.position !== null)
    .sort((a, b) => a.position - b.position);

  let offset = 0;
  for (const entry of ordered) {
    const set = entry.setMinutesOverride ?? event.setMinutes;
    const start = addMinutes(event.startsAt, offset);
    result.set(entry.id, { start, end: addMinutes(start, set) });
    offset += set + event.gapMinutes;
  }
  for (const entry of entries) if (entry.position === null) result.set(entry.id, whole);
  return result;
}

/** Окно расширенное на буфер с обеих сторон (дорога между площадками). */
export function expand(w: Window, bufferMinutes: number): Window {
  return { start: addMinutes(w.start, -bufferMinutes), end: addMinutes(w.end, bufferMinutes) };
}

export function overlaps(a: Window, b: Window): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

export type BusyKind = 'busy' | 'manual_gig';

/** Другое выступление или занятость комика, с которой сравниваем. */
export interface Commitment<Ref> {
  window: Window;
  /** accepted-участие или ручное выступление — нужна дорога; busy — нет. */
  kind: 'gig' | BusyKind;
  ref: Ref;
}

export interface Conflict<Ref> {
  ref: Ref;
  window: Window;
}

/**
 * Конфликты нового выступления с уже имеющимися делами комика.
 * Между двумя выступлениями (в т.ч. ручными) должно оставаться не меньше buffer минут,
 * с занятостью `busy` — просто не пересекаться.
 *
 * TODO(spec): ТЗ говорит «пересечение окон занятости», где окно = сцена ± буфер. Если
 * расширять оба окна, между площадками потребуется 2 × буфер. Считаем, что буфер нужен один раз.
 */
export function findConflicts<Ref>(
  candidate: Window,
  bufferMinutes: number,
  existing: readonly Commitment<Ref>[],
): Conflict<Ref>[] {
  const withBuffer = expand(candidate, bufferMinutes);
  return existing
    .filter((c) => overlaps(c.kind === 'busy' ? candidate : withBuffer, c.window))
    .sort((a, b) => a.window.start.getTime() - b.window.start.getTime())
    .map((c) => ({ ref: c.ref, window: c.window }));
}
