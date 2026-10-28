import {
  bumpLineupVersion,
  findAutoAcceptRule,
  findComedians,
  listComedianGigsInRange,
  listEventParticipations,
  lockComedian,
  recordParticipationEvent,
  updateParticipation,
  type Event,
  type Participation,
  type Tx,
} from '@standup/db';
import {
  checkRule,
  computeSlotWindows,
  hasFreeSlot,
  localDate,
  localToUtc,
  nextPosition,
  shiftLocalDays,
  type AutoAcceptReason,
} from '@standup/domain';
import { scheduleConflicts } from './events';

export type AutoAcceptResult =
  | { accepted: Participation }
  /** Правила нет — обычное приглашение. */
  | { accepted: null; reason: null }
  | { accepted: null; reason: AutoAcceptReason };

/**
 * Автопринятие приглашения (SPEC §6.2). Вызывается в транзакции приглашения после блокировки
 * события; шаги 2–4 идут под advisory-lock на комика, поэтому два одновременных приглашения
 * на одно время не примут оба.
 */
export async function tryAutoAccept(
  tx: Tx,
  p: Participation,
  event: Event,
  timezone: string,
): Promise<AutoAcceptResult> {
  const rule = await findAutoAcceptRule(tx, p.comedianId, event.organizerId);
  if (!rule) return { accepted: null, reason: null };

  await lockComedian(tx, p.comedianId);

  // Выступления комика в тот же местный день (по таймзоне площадки).
  const dayStart = localToUtc(`${localDate(event.startsAt, timezone)}T00:00`, timezone);
  const dayEnd = shiftLocalDays(dayStart, 1, timezone);
  const sameDay = (
    await listComedianGigsInRange(tx, p.comedianId, dayStart, dayEnd, event.id)
  ).filter((g) => g.event.startsAt >= dayStart && g.event.startsAt < dayEnd);
  const check = checkRule(
    {
      enabled: rule.enabled,
      formats: rule.formats,
      weekdays: rule.weekdays,
      timeFrom: rule.timeFrom,
      timeTo: rule.timeTo,
      maxGigsPerDay: rule.maxGigsPerDay,
    },
    { format: event.format, startsAt: event.startsAt, timezone },
    sameDay.length,
  );
  if (!check.ok) return { accepted: null, reason: check.reason };

  const all = await listEventParticipations(tx, event.id);
  const accepted = all.filter((x) => x.status === 'accepted');
  if (!hasFreeSlot(accepted.length, event.slotsCount))
    return { accepted: null, reason: 'lineup_full' };

  const position = nextPosition(all);
  const window = computeSlotWindows(event, [...accepted, { ...p, position }]).get(p.id)!;
  const [comedian] = await findComedians(tx, [p.comedianId]);
  // Автопринятие вопреки пересечению — никогда.
  if (comedian && (await scheduleConflicts(tx, comedian, event.id, window)).length > 0) {
    return { accepted: null, reason: 'conflict' };
  }

  const updated = await updateParticipation(tx, p.id, {
    status: 'accepted',
    position,
    autoAccepted: true,
  });
  await recordParticipationEvent(tx, {
    participationId: p.id,
    actorId: null,
    fromStatus: 'invited',
    toStatus: 'accepted',
    payload: { action: 'auto_accept', ruleId: rule.id },
  });
  await bumpLineupVersion(tx, event.id);
  return { accepted: updated };
}
