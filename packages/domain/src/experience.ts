/** Ступеньки для «примерно столько выступлений»: показываем «500+», а не точное число. */
export const GIG_STEPS = [
  10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000,
] as const;

/** Самый ранний год старта, который принимаем. */
export const FIRST_STAGE_YEAR = 1970;

/** Год старта: не раньше FIRST_STAGE_YEAR и не позже текущего года (по UTC). */
export function isValidStartYear(year: number, now: Date): boolean {
  return Number.isInteger(year) && year >= FIRST_STAGE_YEAR && year <= now.getUTCFullYear();
}

/**
 * Примерное общее число выступлений: месяцы на сцене × выступлений в месяц,
 * округлённое вниз до ступеньки (500, 750, 1000…). Меньше 10 — точное число.
 * Считаем, что начал в середине года старта, но на сцене минимум месяц.
 * null — данных нет.
 */
export function estimateTotalGigs(
  startedYear: number | null,
  gigsPerMonth: number | null,
  now: Date,
): number | null {
  if (startedYear === null || gigsPerMonth === null) return null;
  const months = Math.max(1, (now.getUTCFullYear() - startedYear) * 12 + now.getUTCMonth() - 6);
  const total = months * gigsPerMonth;
  if (total < GIG_STEPS[0]) return total;
  return GIG_STEPS.filter((step) => step <= total).at(-1)!;
}
