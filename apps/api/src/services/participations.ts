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
      // Отвечать можно на приглашение и на срочный вызов из резерва.
      const urgentCall = p.isUrgent && p.status === 'reserve';
      if (
        req.action !== 'withdraw' &&
        !urgentCall &&
        !can({ userId }, 'invitation.respond', resource)
      ) {
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

    const result = transition(p.status, req.action, actor, { urgent: p.isUrgent });
    if (!result.ok) throw new ApiError('INVALID_TRANSITION');
    const to = result.to;

    const patch: Partial<Participation> = { status: to };
    let lineupChanged = false;
    // Срочный вызов закрывается ответом резервиста или любым изменением его статуса.
    if (p.isUrgent && (to !== p.status || req.action === 'decline')) {
      patch.isUrgent = false;
      patch.replacementFor = null;
    }
    let replaced: Participation | undefined;
    let all: Participation[] = [];

    if (to === 'accepted') {
      await lockComedian(tx, p.comedianId);
      all = await listEventParticipations(tx, event.id);
      // Замена: резервист занимает позицию выбывшего, если тот ещё в составе.
      replaced =
        p.isUrgent && p.replacementFor
          ? all.find((x) => x.id === p.replacementFor && x.status === 'accepted')
          : undefined;
      const accepted = all.filter((x) => x.status === 'accepted' && x.id !== replaced?.id);
      if (!hasFreeSlot(accepted.length, event.slotsCount)) throw new ApiError('LINEUP_FULL');

      const position = replaced?.position ?? nextPosition(all);
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
    if (replaced) {
      await updateParticipation(tx, replaced.id, { status: 'removed', position: null });
      await recordParticipationEvent(tx, {
        participationId: replaced.id,
        actorId: userId,
        fromStatus: 'accepted',
        toStatus: 'removed',
        payload: { action: 'replaced', by: p.id },
      });
      // Остальные срочные вызовы на это место больше не актуальны.
      for (const other of all) {
        if (other.id !== p.id && other.isUrgent && other.replacementFor === replaced.id) {
          await updateParticipation(tx, other.id, { isUrgent: false, replacementFor: null });
        }
      }
    }
    if (lineupChanged) {
      if (p.status === 'accepted') await compactLineup(tx, event.id);
      await bumpLineupVersion(tx, event.id);
    }
    // TODO(stage 6): уведомление участнику/организатору о переходе (SPEC §7.2).
    return updated;
  });
}
