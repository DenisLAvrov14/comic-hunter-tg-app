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
  eq,
  schema,
  type Db,
  type DbOrTx,
  type Event,
} from '@standup/db';
import { applyOrder, can, type EventAction } from '@standup/domain';
import {
  AttendanceRequest,
  BroadcastRequest,
  LineupOrderRequest,
  ReplacementRequest,
  StaffPermissionsRequest,
  ru,
  type BroadcastResponse,
  type EventSummary,
  type HostCandidate,
  type Lineup,
  type MyParticipation,
  type PosterText,
} from '@standup/shared';
import type { Config } from '../config';
import { ApiError } from '../errors';
import type { MessageSender } from '../messaging';
import { buildPosterText, posterDate } from '../poster';
import { eventResource, loadLineup, toEventSummary, toMyParticipation } from '../services/events';
import type { FileStorage } from '../storage';

const IdParams = z.object({ id: z.string().uuid() });
const StaffParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const HostsQuery = z.object({ q: z.string().trim().max(64).optional() });

export const lineupRoutes: FastifyPluginAsync<{
  config: Config;
  db: Db;
  storage: FileStorage;
  sender: MessageSender;
}> = async (app, { config, db, storage, sender }) => {
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

  function eventLink(eventId: string): string | null {
    if (!config.botUsername || !config.miniAppShortName) return null;
    return `https://t.me/${config.botUsername}/${config.miniAppShortName}?startapp=e_${eventId}`;
  }

  /** Отправка пользователю; 403 от Telegram помечает его как заблокировавшего бота. */
  async function sendTo(userId: string, text: string, eventId: string): Promise<boolean> {
    const user = await findUserById(db, userId);
    if (!user || !user.botStarted || user.botBlocked) return false;
    const link = eventLink(eventId);
    const result = await sender.send({
      chatId: user.telegramId,
      text,
      ...(link ? { button: { text: ru.messages.openEvent, url: link } } : {}),
    });
    if (result === 'blocked') {
      await db.update(schema.users).set({ botBlocked: true }).where(eq(schema.users.id, userId));
    }
    return result === 'ok';
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
      for (const p of accepted) {
        const position = res.positions.get(p.id)!;
        if (p.position !== position) await updateParticipation(tx, p.id, { position });
      }
      await bumpLineupVersion(tx, id);
      // TODO(stage 6): lineup_position_changed участникам, пересчёт напоминаний перед выходом.
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

  app.post('/events/:id/replacement', async (req): Promise<Lineup> => {
    const { id } = IdParams.parse(req.params);
    const body = ReplacementRequest.parse(req.body);
    const called = await db.transaction(async (tx) => {
      const event = await authorize(tx, await lockEvent(tx, id), req.user.sub, 'reserve.call');
      if (event.status === 'cancelled' || event.status === 'finished') {
        throw new ApiError('INVALID_TRANSITION', 'Событие завершено или отменено');
      }
      const all = await listEventParticipations(tx, id);
      const dropped = all.find((p) => p.id === body.participationId);
      if (!dropped || !['accepted', 'withdrawn', 'removed'].includes(dropped.status)) {
        throw new ApiError('VALIDATION', 'Выбывший участник не найден', {
          field: 'participationId',
        });
      }
      const reserves = all.filter((p) => body.reserveIds.includes(p.id) && p.status === 'reserve');
      if (reserves.length === 0) {
        throw new ApiError('VALIDATION', 'Резервисты не найдены', { field: 'reserveIds' });
      }
      for (const r of reserves) {
        await updateParticipation(tx, r.id, { isUrgent: true, replacementFor: dropped.id });
        await recordParticipationEvent(tx, {
          participationId: r.id,
          actorId: req.user.sub,
          fromStatus: 'reserve',
          toStatus: 'reserve',
          payload: { action: 'call_replacement', replacementFor: dropped.id },
        });
      }
      return reserves;
    });

    const row = (await findEventWithRefs(db, id))!;
    const text = ru.messages.replacement(
      row.event.title,
      posterDate(row.event.startsAt, row.venue.timezone),
      row.venue.name,
    );
    for (const r of called) await sendTo(r.comedianId, text, id);
    return lineupOf(id);
  });

  // --- Рассылка составу ---

  app.post(
    '/events/:id/broadcast',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req): Promise<BroadcastResponse> => {
      const { id } = IdParams.parse(req.params);
      const { text } = BroadcastRequest.parse(req.body);
      const event = await authorize(db, await findEvent(db, id), req.user.sub, 'lineup.notify');
      const accepted = (await listEventParticipations(db, id)).filter(
        (p) => p.status === 'accepted',
      );
      let sent = 0;
      for (const p of accepted) {
        if (await sendTo(p.comedianId, ru.messages.broadcast(event.title, text), id)) sent++;
      }
      return { sent, failed: accepted.length - sent };
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
