import {
  bumpLineupVersion,
  findComedians,
  findParticipation,
  findStaff,
  listEventParticipations,
  lockComedian,
  lockEvent,
  recordParticipationEvent,
  updateParticipation,
  type Db,
  type Participation,
  type Tx,
} from '@standup/db';
import {
  can,
  compactPositions,
  computeSlotWindows,
  hasFreeSlot,
  nextPosition,
  transition,
  type ParticipationActor,
} from '@standup/domain';
import type { ParticipationActionRequest } from '@standup/shared';
import { ApiError } from '../errors';
import { scheduleConflicts } from './events';

/** Комик закрывает место в составе — позиции оставшихся уплотняются. */
async function compactLineup(tx: Tx, eventId: string) {
  const all = await listEventParticipations(tx, eventId);
  for (const p of compactPositions(all)) {
    await updateParticipation(tx, p.id, { position: p.position });
  }
}

/**
 * POST /participations/:id/actions. Всё в одной транзакции: строка события блокируется
 * (FOR UPDATE), принятие в состав — ещё и advisory-lock на комика, чтобы два параллельных
 * принятия не заняли одно время в его календаре.
 */
export async function applyParticipationAction(
  db: Db,
  userId: string,
  participationId: string,
  req: ParticipationActionRequest,
): Promise<Participation> {
  return db.transaction(async (tx) => {
    const current = await findParticipation(tx, participationId);
    if (!current) throw new ApiError('NOT_FOUND');
    const event = await lockEvent(tx, current.eventId);
    if (!event) throw new ApiError('NOT_FOUND');
    // Повторное чтение под блокировкой события: статус мог измениться параллельно.
    const p = (await findParticipation(tx, participationId))!;

    const isComedian = p.comedianId === userId;
    const staff = await findStaff(tx, event.id, userId);
    const resource = {
      event: {
        organizerId: event.organizerId,
        status: event.status,
        recruitmentOpen: event.recruitmentOpen,
      },
      staff: staff ? { permissions: staff.permissions } : null,
      participation: isComedian ? { status: p.status } : null,
    };
    let actor: ParticipationActor;
    if (isComedian) {
      actor = 'comedian';
      if (req.action !== 'withdraw' && !can({ userId }, 'invitation.respond', resource)) {
        throw new ApiError('INVALID_TRANSITION');
      }
    } else if (can({ userId }, 'applications.manage', resource)) {
      actor = 'organizer';
    } else {
      throw new ApiError(staff ? 'FORBIDDEN' : 'NOT_FOUND');
    }
    if (event.status === 'cancelled' || event.status === 'finished') {
      throw new ApiError('INVALID_TRANSITION', 'Событие завершено или отменено');
    }

    const result = transition(p.status, req.action, actor);
    if (!result.ok) throw new ApiError('INVALID_TRANSITION');
    const to = result.to;

    const patch: Partial<Participation> = { status: to };
    let lineupChanged = false;

    if (to === 'accepted') {
      await lockComedian(tx, p.comedianId);
      const all = await listEventParticipations(tx, event.id);
      const accepted = all.filter((x) => x.status === 'accepted');
      if (!hasFreeSlot(accepted.length, event.slotsCount)) throw new ApiError('LINEUP_FULL');

      const position = nextPosition(all);
      const windows = computeSlotWindows(event, [...accepted, { ...p, position }]);
      const [comedian] = await findComedians(tx, [p.comedianId]);
      if (comedian && !req.payload?.force) {
        const conflicts = await scheduleConflicts(tx, comedian, event.id, windows.get(p.id)!);
        if (conflicts.length > 0) {
          throw new ApiError('CONFLICT_SCHEDULE', undefined, { conflicts });
        }
      }
      patch.position = position;
      lineupChanged = true;
    } else if (p.status === 'accepted') {
      patch.position = null;
      lineupChanged = true;
    }
    if (req.action === 'counter_propose') {
      if (!req.payload?.text) {
        throw new ApiError('VALIDATION', 'Опишите встречное предложение', { field: 'text' });
      }
      patch.counterProposal = req.payload.text;
    }

    const updated = await updateParticipation(tx, p.id, patch);
    await recordParticipationEvent(tx, {
      participationId: p.id,
      actorId: userId,
      fromStatus: p.status,
      toStatus: to,
      payload: { action: req.action, ...(req.payload ?? {}) },
    });
    if (lineupChanged) {
      if (p.status === 'accepted') await compactLineup(tx, event.id);
      await bumpLineupVersion(tx, event.id);
    }
    // TODO(stage 6): уведомление участнику/организатору о переходе (SPEC §7.2).
    return updated;
  });
}
