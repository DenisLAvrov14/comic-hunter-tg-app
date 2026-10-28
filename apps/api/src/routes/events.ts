import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  countPastGigs,
  createEvent,
  findComedians,
  findEvent,
  findEventByLinkToken,
  findEventWithRefs,
  findUserParticipation,
  getUserRoles,
  listComedianParticipations,
  listOpenEvents,
  listOrganizerEvents,
  listPhotos,
  lockEvent,
  recordParticipationEvent,
  searchComedians,
  updateEvent,
  upsertParticipation,
  type Db,
  type Event,
  type Venue,
} from '@standup/db';
import {
  can,
  eventWindow,
  initialStatus,
  isActive,
  localToUtc,
  shiftLocalDays,
} from '@standup/domain';
import {
  ApplicationRequest,
  ComediansQuery,
  EventInput,
  EventPatch,
  EventsQuery,
  InvitationsRequest,
  ParticipationActionRequest,
  type ComedianBrief,
  type ComedianCard,
  type EventDetails,
  type EventSummary,
  type Inbox,
  type InvitationsResponse,
  type Lineup,
  type MyParticipation,
} from '@standup/shared';
import { ApiError } from '../errors';
import {
  eventResource,
  loadEventDetails,
  loadLineup,
  newLinkToken,
  scheduleConflicts,
  toComedianBrief,
  toEventSummary,
  toMyParticipation,
  windowEnd,
} from '../services/events';
import { toPhoto } from '../services/me';
import { applyParticipationAction } from '../services/participations';
import type { FileStorage } from '../storage';

const IdParams = z.object({ id: z.string().uuid() });
const TokenParams = z.object({ token: z.string().min(10).max(100) });
const WhenQuery = z.object({ when: z.enum(['upcoming', 'past']).default('upcoming') });
const DuplicateRequest = z.object({ startsAtLocal: z.string().optional() }).default({});

export const eventRoutes: FastifyPluginAsync<{ db: Db; storage: FileStorage }> = async (
  app,
  { db, storage },
) => {
  app.addHook('onRequest', app.authenticate);

  async function requireRole(userId: string, role: 'comedian' | 'organizer') {
    // Роль пользователя, а не право на событие — can() здесь не нужен.
    const roles = await getUserRoles(db, userId);
    if (!roles.includes(role)) throw new ApiError('FORBIDDEN');
  }

  async function requireVenue(venueId: string): Promise<Venue> {
    const venue = await db.query.venues.findFirst({ where: (v, { eq }) => eq(v.id, venueId) });
    if (!venue) throw new ApiError('VALIDATION', 'Площадка не найдена', { field: 'venueId' });
    return venue;
  }

  /** Событие + проверка права. Нет права видеть — 404, чтобы не раскрывать существование. */
  async function eventFor(userId: string, id: string, action: Parameters<typeof can>[1]) {
    const event = await findEvent(db, id);
    if (!event) throw new ApiError('NOT_FOUND');
    const resource = await eventResource(db, event, userId);
    if (!can({ userId }, 'event.view', resource)) throw new ApiError('NOT_FOUND');
    if (!can({ userId }, action, resource)) throw new ApiError('FORBIDDEN');
    return event;
  }

  function timing(
    venue: Venue,
    body: { startsAtLocal?: string; endsAtLocal?: string | null },
    current?: Event,
  ) {
    const startsAt = body.startsAtLocal
      ? localToUtc(body.startsAtLocal, venue.timezone)
      : current!.startsAt;
    const endsAt =
      body.endsAtLocal === undefined
        ? (current?.endsAt ?? null)
        : body.endsAtLocal === null
          ? null
          : localToUtc(body.endsAtLocal, venue.timezone);
    if (endsAt && endsAt <= startsAt) {
      throw new ApiError('VALIDATION', 'Окончание должно быть позже начала', {
        field: 'endsAtLocal',
      });
    }
    return { startsAt, endsAt };
  }

  // --- События ---

  app.get('/events', async (req): Promise<EventSummary[]> => {
    const q = EventsQuery.parse(req.query);
    const rows = await listOpenEvents(db, {
      cityId: q.city,
      from: q.from ? new Date(q.from) : new Date(),
      to: q.to ? new Date(q.to) : undefined,
      format: q.format,
    });
    return rows.map(toEventSummary);
  });

  app.get('/me/events', async (req): Promise<EventSummary[]> => {
    const { when } = WhenQuery.parse(req.query);
    return (await listOrganizerEvents(db, req.user.sub, when, new Date())).map(toEventSummary);
  });

  app.post('/events', async (req, reply): Promise<EventDetails> => {
    const body = EventInput.parse(req.body);
    await requireRole(req.user.sub, 'organizer');
    const venue = await requireVenue(body.venueId);
    const { startsAt, endsAt } = timing(venue, body);
    const fields = {
      slotsCount: body.slotsCount,
      setMinutes: body.setMinutes,
      gapMinutes: body.gapMinutes,
    };
    const event = await createEvent(db, {
      organizerId: req.user.sub,
      venueId: venue.id,
      title: body.title,
      format: body.format,
      formatNote: body.formatNote ?? null,
      startsAt,
      endsAt,
      windowEndsAt: windowEnd({ startsAt, endsAt, ...fields }),
      ...fields,
      conditions: body.conditions,
      recruitmentOpen: body.recruitmentOpen,
      showLineup: body.showLineup,
      status: body.status,
      recruitmentLinkToken: newLinkToken(),
    });
    reply.status(201);
    return loadEventDetails(db, req.user.sub, event.id);
  });

  app.get('/events/:id', async (req): Promise<EventDetails> => {
    const { id } = IdParams.parse(req.params);
    return loadEventDetails(db, req.user.sub, id);
  });

  app.get('/events/by-link/:token', async (req): Promise<EventDetails> => {
    const { token } = TokenParams.parse(req.params);
    const event = await findEventByLinkToken(db, token);
    if (!event) throw new ApiError('NOT_FOUND');
    return loadEventDetails(db, req.user.sub, event.id, { viaLink: true });
  });

  app.patch('/events/:id', async (req): Promise<EventDetails> => {
    const { id } = IdParams.parse(req.params);
    const body = EventPatch.parse(req.body);
    await db.transaction(async (tx) => {
      const event = await lockEvent(tx, id);
      if (!event) throw new ApiError('NOT_FOUND');
      if (
        !can({ userId: req.user.sub }, 'event.edit', await eventResource(tx, event, req.user.sub))
      ) {
        throw new ApiError(event.organizerId === req.user.sub ? 'FORBIDDEN' : 'NOT_FOUND');
      }
      if (event.status === 'cancelled') {
        throw new ApiError('INVALID_TRANSITION', 'Событие отменено');
      }
      const venue = await requireVenue(body.venueId ?? event.venueId);
      const { startsAt, endsAt } = timing(venue, body, event);
      const slotsCount = body.slotsCount ?? event.slotsCount;
      const accepted = (
        await tx.query.participations.findMany({
          where: (p, { and, eq }) => and(eq(p.eventId, id), eq(p.status, 'accepted')),
        })
      ).length;
      if (slotsCount < accepted) {
        throw new ApiError('VALIDATION', `В составе уже ${accepted} — уменьшить нельзя`, {
          field: 'slotsCount',
        });
      }
      const fields = {
        slotsCount,
        setMinutes: body.setMinutes ?? event.setMinutes,
        gapMinutes: body.gapMinutes ?? event.gapMinutes,
      };
      await updateEvent(tx, id, {
        venueId: venue.id,
        title: body.title,
        format: body.format,
        formatNote: body.formatNote,
        startsAt,
        endsAt,
        windowEndsAt: windowEnd({ startsAt, endsAt, ...fields }),
        ...fields,
        conditions: body.conditions,
        recruitmentOpen: body.recruitmentOpen,
        showLineup: body.showLineup,
        status: body.status,
      });
      // TODO(stage 6): rescheduleForEvent, повторная проверка пересечений у состава и
      // уведомление event_changed при смене времени или площадки.
    });
    return loadEventDetails(db, req.user.sub, id);
  });

  app.post('/events/:id/cancel', async (req): Promise<EventDetails> => {
    const { id } = IdParams.parse(req.params);
    const event = await eventFor(req.user.sub, id, 'event.edit');
    if (event.status !== 'cancelled') await updateEvent(db, id, { status: 'cancelled' });
    // TODO(stage 6): event_cancelled участникам, отмена pending-уведомлений.
    return loadEventDetails(db, req.user.sub, id);
  });

  app.post('/events/:id/duplicate', async (req, reply): Promise<EventDetails> => {
    const { id } = IdParams.parse(req.params);
    const body = DuplicateRequest.parse(req.body ?? {});
    const src = await eventFor(req.user.sub, id, 'event.edit');
    const venue = await requireVenue(src.venueId);
    // По умолчанию — через неделю в то же местное время.
    const startsAt = body.startsAtLocal
      ? localToUtc(body.startsAtLocal, venue.timezone)
      : shiftLocalDays(src.startsAt, 7, venue.timezone);
    const shift = startsAt.getTime() - src.startsAt.getTime();
    const endsAt = src.endsAt ? new Date(src.endsAt.getTime() + shift) : null;
    const copy = await createEvent(db, {
      organizerId: req.user.sub,
      venueId: src.venueId,
      title: src.title,
      format: src.format,
      formatNote: src.formatNote,
      startsAt,
      endsAt,
      windowEndsAt: eventWindow({ ...src, startsAt, endsAt }).end,
      slotsCount: src.slotsCount,
      setMinutes: src.setMinutes,
      gapMinutes: src.gapMinutes,
      conditions: src.conditions,
      recruitmentOpen: src.recruitmentOpen,
      showLineup: src.showLineup,
      status: 'draft',
      recruitmentLinkToken: newLinkToken(),
    });
    reply.status(201);
    return loadEventDetails(db, req.user.sub, copy.id);
  });

  app.post('/events/:id/link/rotate', async (req): Promise<EventDetails> => {
    const { id } = IdParams.parse(req.params);
    await eventFor(req.user.sub, id, 'event.edit');
    await updateEvent(db, id, { recruitmentLinkToken: newLinkToken() });
    return loadEventDetails(db, req.user.sub, id);
  });

  // --- Набор ---

  app.post('/events/:id/applications', async (req, reply): Promise<MyParticipation> => {
    const { id } = IdParams.parse(req.params);
    const body = ApplicationRequest.parse(req.body ?? {});
    const userId = req.user.sub;
    await requireRole(userId, 'comedian');
    const [profile] = await findComedians(db, [userId]);
    if (!profile) throw new ApiError('VALIDATION', 'Сначала заполните профиль комика');

    const participation = await db.transaction(async (tx) => {
      const event = await lockEvent(tx, id);
      if (!event) throw new ApiError('NOT_FOUND');
      const viaLink = !!body.token && body.token === event.recruitmentLinkToken;
      const resource = await eventResource(tx, event, userId, { viaLink });
      if (!can({ userId }, 'event.view', resource)) throw new ApiError('NOT_FOUND');
      if (!can({ userId }, 'event.apply', resource)) throw new ApiError('INVALID_TRANSITION');

      const source = viaLink && !event.recruitmentOpen ? 'link' : 'application';
      const { participation: p, previousStatus } = await upsertParticipation(tx, {
        eventId: id,
        comedianId: userId,
        source,
        status: initialStatus(source),
        invitedBy: null,
        message: body.message ?? null,
        isUrgent: false,
      });
      await recordParticipationEvent(tx, {
        participationId: p.id,
        actorId: userId,
        fromStatus: previousStatus,
        toStatus: p.status,
        payload: { action: 'apply', source },
      });
      // TODO(stage 6): new_application организатору (не чаще раза в 15 минут на событие).
      return p;
    });
    reply.status(201);
    return toMyParticipation(participation);
  });

  app.post('/events/:id/invitations', async (req): Promise<InvitationsResponse> => {
    const { id } = IdParams.parse(req.params);
    const body = InvitationsRequest.parse(req.body);
    const userId = req.user.sub;
    const ids = [...new Set(body.comedianIds)];

    return db.transaction(async (tx) => {
      const event = await lockEvent(tx, id);
      if (!event) throw new ApiError('NOT_FOUND');
      if (!can({ userId }, 'comedians.invite', await eventResource(tx, event, userId))) {
        throw new ApiError(event.organizerId === userId ? 'FORBIDDEN' : 'NOT_FOUND');
      }
      if (event.status === 'cancelled' || event.status === 'finished') {
        throw new ApiError('INVALID_TRANSITION', 'Событие завершено или отменено');
      }
      const known = new Set((await findComedians(tx, ids)).map((c) => c.userId));
      const invited: string[] = [];
      const skipped: string[] = [];
      for (const comedianId of ids) {
        const existing = await findUserParticipation(tx, id, comedianId);
        if (
          !known.has(comedianId) ||
          comedianId === userId ||
          (existing && isActive(existing.status))
        ) {
          skipped.push(comedianId);
          continue;
        }
        const { participation: p, previousStatus } = await upsertParticipation(tx, {
          eventId: id,
          comedianId,
          source: 'invitation',
          status: initialStatus('invitation'),
          invitedBy: userId,
          message: body.message ?? null,
          isUrgent: false,
        });
        await recordParticipationEvent(tx, {
          participationId: p.id,
          actorId: userId,
          fromStatus: previousStatus,
          toStatus: p.status,
          payload: { action: 'invite' },
        });
        // TODO(stage 7): автопринятие по auto_accept_rules. TODO(stage 6): invitation_received.
        invited.push(comedianId);
      }
      return { invited, skipped };
    });
  });

  app.get('/events/:id/lineup', async (req): Promise<Lineup> => {
    const { id } = IdParams.parse(req.params);
    const row = await findEventWithRefs(db, id);
    if (!row) throw new ApiError('NOT_FOUND');
    const resource = await eventResource(db, row.event, req.user.sub);
    // Полный состав с заявками — организатору и штату.
    if (row.event.organizerId !== req.user.sub && !resource.staff) throw new ApiError('NOT_FOUND');
    return loadLineup(db, storage, row.event, row.venue.timezone);
  });

  app.post('/participations/:id/actions', async (req): Promise<MyParticipation> => {
    const { id } = IdParams.parse(req.params);
    const body = ParticipationActionRequest.parse(req.body);
    return toMyParticipation(await applyParticipationAction(db, req.user.sub, id, body));
  });

  // --- Входящие комика ---

  app.get('/me/inbox', async (req): Promise<Inbox> => {
    const userId = req.user.sub;
    const rows = await listComedianParticipations(
      db,
      userId,
      ['invited', 'counter_proposed', 'pending', 'accepted', 'reserve', 'rejected', 'declined'],
      new Date(),
    );
    const item = (r: (typeof rows)[number]) => ({
      participation: toMyParticipation(r.participation),
      event: toEventSummary(r),
    });
    return {
      invitations: rows
        .filter(
          (r) =>
            r.participation.source === 'invitation' &&
            ['invited', 'counter_proposed'].includes(r.participation.status),
        )
        .map(item),
      applications: rows.filter((r) => r.participation.source !== 'invitation').map(item),
    };
  });

  // --- Поиск комиков ---

  app.get('/comedians', async (req): Promise<Array<ComedianBrief & { cityId: number }>> => {
    const q = ComediansQuery.parse(req.query);
    await requireRole(req.user.sub, 'organizer');
    let rows = await searchComedians(db, {
      text: q.q,
      cityId: q.city,
      category: q.category,
      limit: q.freeAtEvent ? 200 : 50,
    });
    if (q.freeAtEvent) {
      const event = await eventFor(req.user.sub, q.freeAtEvent, 'comedians.invite');
      const window = eventWindow(event);
      const free = await Promise.all(
        rows.map(async (c) => (await scheduleConflicts(db, c, event.id, window)).length === 0),
      );
      rows = rows.filter((_, i) => free[i]).slice(0, 50);
    }
    return rows.map((c) => ({ ...toComedianBrief(storage, c), cityId: c.cityId }));
  });

  app.get('/comedians/:id', async (req): Promise<ComedianCard> => {
    const { id } = IdParams.parse(req.params);
    await requireRole(req.user.sub, 'organizer');
    const [c] = await findComedians(db, [id]);
    if (!c) throw new ApiError('NOT_FOUND');
    const [photos, gigsCount] = await Promise.all([
      listPhotos(db, id),
      countPastGigs(db, id, new Date()),
    ]);
    return {
      id: c.userId,
      stageName: c.stageName,
      category: c.category,
      cityId: c.cityId,
      bio: c.bio,
      links: c.links,
      photos: photos.map((p) => toPhoto(storage, p)),
      gigsCount,
      contact: c.contact,
    };
  });
};
