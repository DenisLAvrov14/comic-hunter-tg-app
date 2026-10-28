import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  bumpLineupVersion,
  deleteStaff,
  findComedians,
  findEvent,
  findEventWithRefs,
  findParticipation,
  findUserById,
  getUserRoles,
  listEventParticipations,
  listHostedEvents,
  listStaff,
  lockEvent,
  recordParticipationEvent,
  searchHosts,
  updateParticipation,
  upsertStaff,
  type Db,
  type DbOrTx,
  type Event,
} from '@standup/db';
import { applyOrder, can, type EventAction } from '@standup/domain';
import {
  AttendanceRequest,
  BroadcastRequest,
  DayConfirmationRequest,
  LineupOrderRequest,
  ReplacementRequest,
  StaffPermissionsRequest,
  type BroadcastResponse,
  type EventSummary,
  type HostCandidate,
  type Lineup,
  type MyParticipation,
  type PosterText,
} from '@standup/shared';
import {
  enqueueNow,
  notifyDayConfirmation,
  notifyPositionChanges,
  rescheduleForEvent,
} from '@standup/notify';
import { ApiError } from '../errors';
import { buildPosterText } from '../poster';
import { eventResource, loadLineup, toEventSummary, toMyParticipation } from '../services/events';
import type { FileStorage } from '../storage';

const IdParams = z.object({ id: z.string().uuid() });
const StaffParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const HostsQuery = z.object({ q: z.string().trim().max(64).optional() });

export const lineupRoutes: FastifyPluginAsync<{
  db: Db;
  storage: FileStorage;
}> = async (app, { db, storage }) => {
  app.addHook('onRequest', app.authenticate);

  /** Проверка права на событии. Не видит событие — 404, видит без права — 403. */
  async function authorize(
    tx: DbOrTx,
    event: Event | undefined,
    userId: string,
    action: EventAction,
  ) {
    if (!event) throw new ApiError('NOT_FOUND');
    const resource = await eventResource(tx, event, userId);
    if (!can({ userId }, action, resource)) {
      const visible = event.organizerId === userId || !!resource.staff;
      throw new ApiError(visible ? 'FORBIDDEN' : 'NOT_FOUND');
    }
    return event;
  }

  async function lineupOf(eventId: string): Promise<Lineup> {
    const row = (await findEventWithRefs(db, eventId))!;
    return loadLineup(db, storage, row.event, row.venue.timezone);
  }

  // --- Порядок выхода ---

  app.patch('/events/:id/lineup/order', async (req): Promise<Lineup> => {
    const { id } = IdParams.parse(req.params);
    const body = LineupOrderRequest.parse(req.body);
    await db.transaction(async (tx) => {
      const event = await authorize(tx, await lockEvent(tx, id), req.user.sub, 'lineup.reorder');
      // Оптимистическая блокировка: второй редактор получает 409 и перезагружает состав.
      if (event.lineupVersion !== body.version) {
        throw new ApiError('VERSION_MISMATCH', undefined, { version: event.lineupVersion });
      }
      const accepted = (await listEventParticipations(tx, id)).filter(
        (p) => p.status === 'accepted',
      );
      const res = applyOrder(
        accepted.map((p) => p.id),
        body.order,
      );
      if (!res.ok)
        throw new ApiError('VERSION_MISMATCH', undefined, { version: event.lineupVersion });
      const changed = accepted.filter((p) => p.position !== res.positions.get(p.id));
      for (const p of changed) {
        await updateParticipation(tx, p.id, { position: res.positions.get(p.id)! });
      }
      await bumpLineupVersion(tx, id);
      const now = new Date();
      await notifyPositionChanges(tx, id, changed, now);
      // Время выхода сдвинулось — напоминания перед выходом пересчитываются.
      await rescheduleForEvent(tx, id, now);
    });
    return lineupOf(id);
  });

  // --- Присутствие ---

  app.post('/participations/:id/attendance', async (req): Promise<MyParticipation> => {
    const { id } = IdParams.parse(req.params);
    const { value } = AttendanceRequest.parse(req.body);
    const p = await findParticipation(db, id);
    if (!p) throw new ApiError('NOT_FOUND');
    await authorize(db, await findEvent(db, p.eventId), req.user.sub, 'attendance.mark');
    if (p.status !== 'accepted') throw new ApiError('INVALID_TRANSITION');
    return toMyParticipation(await updateParticipation(db, id, { attendance: value }));
  });

  // --- Замена из резерва ---

  /** Срочно зовёт резервистов на место выбывшего; первый согласившийся займёт позицию. */
  async function callReplacement(
    userId: string,
    id: string,
    droppedId: string,
    pick: (reserveIds: string[]) => Promise<string[]> | string[],
  ): Promise<number> {
    return db.transaction(async (tx) => {
      const event = await authorize(tx, await lockEvent(tx, id), userId, 'reserve.call');
      if (event.status === 'cancelled' || event.status === 'finished') {
        throw new ApiError('INVALID_TRANSITION', 'Событие завершено или отменено');
      }
      const all = await listEventParticipations(tx, id);
      const dropped = all.find((p) => p.id === droppedId);
      if (!dropped || !['accepted', 'withdrawn', 'removed'].includes(dropped.status)) {
        throw new ApiError('VALIDATION', 'Выбывший участник не найден', {
          field: 'participationId',
        });
      }
      const chosen = await pick(all.filter((p) => p.status === 'reserve').map((p) => p.id));
      const reserves = all.filter((p) => chosen.includes(p.id) && p.status === 'reserve');
      if (reserves.length === 0) return 0;
      for (const r of reserves) {
        await updateParticipation(tx, r.id, { isUrgent: true, replacementFor: dropped.id });
        await recordParticipationEvent(tx, {
          participationId: r.id,
          actorId: userId,
          fromStatus: 'reserve',
          toStatus: 'reserve',
          payload: { action: 'call_replacement', replacementFor: dropped.id },
        });
      }
      await enqueueNow(
        tx,
        reserves.map((r) => ({
          userId: r.comedianId,
          kind: 'replacement_request' as const,
          participationId: r.id,
          eventId: id,
        })),
        new Date(),
      );
      return reserves.length;
    });
  }

  app.post('/events/:id/replacement', async (req): Promise<Lineup> => {
    const { id } = IdParams.parse(req.params);
    const body = ReplacementRequest.parse(req.body);
    const n = await callReplacement(req.user.sub, id, body.participationId, () => body.reserveIds);
    if (n === 0) throw new ApiError('VALIDATION', 'Резервисты не найдены', { field: 'reserveIds' });
    return lineupOf(id);
  });

  // Кнопка «Позвать резерв» в уведомлении: зовём всех резервистов без пересечений.
  app.post('/participations/:id/call-reserve', async (req): Promise<{ called: number }> => {
    const { id } = IdParams.parse(req.params);
    const p = await findParticipation(db, id);
    if (!p) throw new ApiError('NOT_FOUND');
    const called = await callReplacement(req.user.sub, p.eventId, id, async () => {
      const lineup = await lineupOf(p.eventId);
      return lineup.reserve.filter((r) => r.conflicts.length === 0).map((r) => r.id);
    });
    return { called };
  });

  // --- Подтверждение в день выступления ---

  app.post('/participations/:id/day-confirmation', async (req): Promise<MyParticipation> => {
    const { id } = IdParams.parse(req.params);
    const { value } = DayConfirmationRequest.parse(req.body);
    const updated = await db.transaction(async (tx) => {
      const p = await findParticipation(tx, id);
      if (!p || p.comedianId !== req.user.sub) throw new ApiError('NOT_FOUND');
      if (p.status !== 'accepted') throw new ApiError('INVALID_TRANSITION');
      const event = (await findEvent(tx, p.eventId))!;
      const next = await updateParticipation(tx, id, {
        dayConfirmation: value,
        dayConfirmedAt: new Date(),
      });
      if (p.dayConfirmation !== value) await notifyDayConfirmation(tx, next, event, new Date());
      return next;
    });
    return toMyParticipation(updated);
  });

  // --- Рассылка составу ---

  app.post(
    '/events/:id/broadcast',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<BroadcastResponse> => {
      const { id } = IdParams.parse(req.params);
      const { text } = BroadcastRequest.parse(req.body);
      await authorize(db, await findEvent(db, id), req.user.sub, 'lineup.notify');
      const accepted = (await listEventParticipations(db, id)).filter(
        (p) => p.status === 'accepted',
      );
      const users = await Promise.all(accepted.map((p) => findUserById(db, p.comedianId)));
      const reachable = accepted.filter((_, i) => users[i]?.botStarted && !users[i]?.botBlocked);
      await enqueueNow(
        db,
        reachable.map((p) => ({
          userId: p.comedianId,
          kind: 'broadcast' as const,
          participationId: p.id,
          eventId: id,
          payload: { text },
        })),
        new Date(),
      );
      return { queued: reachable.length, skipped: accepted.length - reachable.length };
    },
  );

  // --- Текст для афиши ---

  app.get('/events/:id/poster-text', async (req): Promise<PosterText> => {
    const { id } = IdParams.parse(req.params);
    const row = await findEventWithRefs(db, id);
    const resource = row && (await eventResource(db, row.event, req.user.sub));
    if (!row || !resource || (row.event.organizerId !== req.user.sub && !resource.staff)) {
      throw new ApiError('NOT_FOUND');
    }
    const accepted = (await listEventParticipations(db, id))
      .filter((p) => p.status === 'accepted' && p.position !== null)
      .sort((a, b) => a.position! - b.position!);
    const comedians = new Map(
      (
        await findComedians(
          db,
          accepted.map((p) => p.comedianId),
        )
      ).map((c) => [c.userId, c]),
    );
    const hosts = (await listStaff(db, id)).map((s) => s.name);
    return {
      text: buildPosterText({
        title: row.event.title,
        startsAt: row.event.startsAt,
        timezone: row.venue.timezone,
        venue: row.venue,
        hosts,
        lineup: accepted.map((p) => {
          const c = comedians.get(p.comedianId);
          return { stageName: c?.stageName ?? '—', link: c?.links[0]?.url ?? null };
        }),
        conditions: row.event.conditions,
      }),
    };
  });

  // --- Ведущие ---

  app.get('/hosts', async (req): Promise<HostCandidate[]> => {
    const { q } = HostsQuery.parse(req.query);
    const roles = await getUserRoles(db, req.user.sub);
    if (!roles.includes('organizer')) throw new ApiError('FORBIDDEN');
    return (await searchHosts(db, q || undefined)).map((h) => ({
      ...h,
      username: h.username ?? null,
    }));
  });

  app.put('/events/:id/staff/:userId', async (req): Promise<Lineup> => {
    const { id, userId } = StaffParams.parse(req.params);
    const { permissions } = StaffPermissionsRequest.parse(req.body);
    await authorize(db, await findEvent(db, id), req.user.sub, 'staff.assign');
    if (!(await getUserRoles(db, userId)).includes('host')) {
      throw new ApiError('VALIDATION', 'У пользователя нет роли ведущего', { field: 'userId' });
    }
    await upsertStaff(db, { eventId: id, userId, permissions });
    return lineupOf(id);
  });

  app.delete('/events/:id/staff/:userId', async (req): Promise<Lineup> => {
    const { id, userId } = StaffParams.parse(req.params);
    await authorize(db, await findEvent(db, id), req.user.sub, 'staff.assign');
    await deleteStaff(db, id, userId);
    return lineupOf(id);
  });

  app.get('/me/hosting', async (req): Promise<EventSummary[]> =>
    (await listHostedEvents(db, req.user.sub, new Date())).map(toEventSummary),
  );
};
