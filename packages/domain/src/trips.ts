// Поездка комика в другой город: даты вида yyyy-MM-dd, оба края включены.

export const MAX_TRIP_DAYS = 60;

export type TripDateError = 'end_before_start' | 'in_past' | 'too_long';

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

export function tripDateError(
  startsOn: string,
  endsOn: string,
  today: string,
): TripDateError | null {
  if (endsOn < startsOn) return 'end_before_start';
  if (endsOn < today) return 'in_past';
  if (dayNumber(endsOn) - dayNumber(startsOn) + 1 > MAX_TRIP_DAYS) return 'too_long';
  return null;
}
