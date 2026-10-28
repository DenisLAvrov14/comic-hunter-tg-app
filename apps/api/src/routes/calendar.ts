import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  createBusySlot,
  deleteAutoAcceptRule,
  deleteBusySlot,
  findActiveFeed,
  findUserById,
  findUserByFeedToken,
  getUserRoles,
  listAcceptedForEvents,
  listBusySlotsInRange,
  listCalendarGigs,
  listAutoAcceptRules,
  listFeedGigs,
  listManualGigs,
  putFeedToken,
  searchOrganizers,
  upsertAutoAcceptRule,
  type Db,
} from '@standup/db';
import { computeSlotWindows, eventWindow, localToUtc } from '@standup/domain';
import {
  AutoAcceptRuleInput,
  BusySlotInput,
  CalendarQuery,
  type AutoAcceptRule,
  type CalendarBusy,
  type CalendarFeed,
  type CalendarGig,
  type CalendarResponse,
  type OrganizerCandidate,
} from '@standup/shared';
import { ApiError } from '../errors';
import { buildIcs } from '../ics';

const OrganizerParams = z.object({ organizerId: z.string().uuid() });
const IdParams = z.object({ id: z.string().uuid() });
const SearchQuery = z.object({ q: z.string().trim().max(64).optional() });
const DAY = 86_400_000;

/** Окна на сцене для выступлений комика (по составам их событий). */
async function stageWindows(db: Db, gigs: Awaited<ReturnType<typeof listCalendarGigs>>) {
  const lineups = await listAcceptedForEvents(
    db,
    gigs.map((g) => g.event.id),
  );
  return new Map(
    gigs.map((g) => {
      const w = computeSlotWindows(
        g.event,
        lineups.filter((l) => l.eventId === g.event.id),
      ).get(g.participation.id);
      return [g.participation.id, w ?? eventWindow(g.event)];
    }),
  );
}

export const calendarRoutes: FastifyPluginAsync<{ db: Db; publicBaseUrl: string }> = async (
  app,
  { db, publicBaseUrl },
) => {
  app.addHook('onRequest', app.authenticate);

  async function requireComedian(userId: string) {
    if (!(await getUserRoles(db, userId)).includes('comedian')) throw new ApiError('FORBIDDEN');
  }

  // --- Мой календарь ---

  app.get('/me/calendar', async (req): Promise<CalendarResponse> => {
    const q = CalendarQuery.parse(req.query);
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (to <= from || to.getTime() - from.getTime() > 120 * DAY) {
      throw new ApiError('VALIDATION', 'Диапазон — до 120 дней');
    }
    const user = (await findUserById(db, req.user.sub))!;
    const [gigs, busy] = await Promise.all([
      listCalendarGigs(db, user.id, from, to),
      listBusySlotsInRange(db, user.id, from, to),
    ]);
    const windows = await stageWindows(db, gigs);
    const items: Array<CalendarGig | CalendarBusy> = [
      ...gigs.map((g): CalendarGig => {
        const w = windows.get(g.participation.id)!;
        return {
          type: 'gig',
          participationId: g.participation.id,
          eventId: g.event.id,
          title: g.event.title,
          venue: g.venue.name,
          address: g.venue.address,
          timezone: g.venue.timezone,
          startsAt: g.event.startsAt.toISOString(),
          endsAt: g.event.windowEndsAt.toISOString(),
          position: g.participation.position,
          stageStart: w.start.toISOString(),
          stageEnd: w.end.toISOString(),
          dayConfirmation: g.participation.dayConfirmation,
          autoAccepted: g.participation.autoAccepted,
        };
      }),
      ...busy.map((b): CalendarBusy => ({
        type: b.kind,
        id: b.id,
        title: b.title,
        venueText: b.venueText,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt.toISOString(),
      })),
    ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return { timezone: user.timezone, items };
  });

  app.post('/me/busy-slots', async (req, reply): Promise<CalendarBusy> => {
    const body = BusySlotInput.parse(req.body);
    const user = (await findUserById(db, req.user.sub))!;
    const startsAt = localToUtc(body.startsAtLocal, user.timezone);
    const endsAt = localToUtc(body.endsAtLocal, user.timezone);
    if (endsAt <= startsAt) {
      throw new ApiError('VALIDATION', 'Окончание должно быть позже начала', {
        field: 'endsAtLocal',
      });
    }
    const slot = await createBusySlot(db, {
      userId: user.id,
      kind: body.kind,
      startsAt,
      endsAt,
      title: body.title ?? null,
      venueText: body.venueText ?? null,
    });
    reply.status(201);
    return {
      type: slot.kind,
      id: slot.id,
      title: slot.title,
      venueText: slot.venueText,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
    };
  });

  app.delete('/me/busy-slots/:id', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    if (!(await deleteBusySlot(db, id, req.user.sub))) throw new ApiError('NOT_FOUND');
    return reply.status(204).send();
  });

  // --- Правила автопринятия ---

  const toRule = (r: Awaited<ReturnType<typeof listAutoAcceptRules>>[number]): AutoAcceptRule => ({
    organizerId: r.rule.organizerId,
    organizerName: r.organizerName,
    projectName: r.projectName,
    enabled: r.rule.enabled,
    formats: r.rule.formats,
    weekdays: r.rule.weekdays,
    timeFrom: r.rule.timeFrom,
    timeTo: r.rule.timeTo,
    maxGigsPerDay: r.rule.maxGigsPerDay,
  });

  app.get('/me/auto-accept-rules', async (req): Promise<AutoAcceptRule[]> =>
    (await listAutoAcceptRules(db, req.user.sub)).map(toRule),
  );

  app.put('/me/auto-accept-rules/:organizerId', async (req): Promise<AutoAcceptRule[]> => {
    const { organizerId } = OrganizerParams.parse(req.params);
    const body = AutoAcceptRuleInput.parse(req.body);
    await requireComedian(req.user.sub);
    if (
      organizerId === req.user.sub ||
      !(await getUserRoles(db, organizerId)).includes('organizer')
    ) {
      throw new ApiError('VALIDATION', 'Организатор не найден', { field: 'organizerId' });
    }
    // Выключение правила не трогает уже принятые выступления (SPEC §6.2).
    await upsertAutoAcceptRule(db, { comedianId: req.user.sub, organizerId, ...body });
    return (await listAutoAcceptRules(db, req.user.sub)).map(toRule);
  });

  app.delete('/me/auto-accept-rules/:organizerId', async (req): Promise<AutoAcceptRule[]> => {
    const { organizerId } = OrganizerParams.parse(req.params);
    await deleteAutoAcceptRule(db, req.user.sub, organizerId);
    return (await listAutoAcceptRules(db, req.user.sub)).map(toRule);
  });

  app.get('/organizers', async (req): Promise<OrganizerCandidate[]> => {
    const { q } = SearchQuery.parse(req.query);
    return (await searchOrganizers(db, q || undefined)).filter((o) => o.userId !== req.user.sub);
  });

  // --- Подписка на календарь ---

  const feedUrls = (token: string): CalendarFeed => {
    const url = `${publicBaseUrl.replace(/\/$/, '')}/cal/${token}.ics`;
    return { url, webcalUrl: url.replace(/^https?:\/\//, 'webcal://') };
  };

  app.get('/me/calendar-feed', async (req): Promise<CalendarFeed> => {
    const feed =
      (await findActiveFeed(db, req.user.sub)) ??
      (await putFeedToken(db, req.user.sub, randomBytes(32).toString('base64url')));
    return feedUrls(feed.token);
  });

  app.post('/me/calendar-feed/rotate', async (req): Promise<CalendarFeed> => {
    const feed = await putFeedToken(db, req.user.sub, randomBytes(32).toString('base64url'));
    return feedUrls(feed.token);
  });
};

/** GET /cal/:token.ics — публичный, без авторизации; токен — 32 случайных байта. */
export const icsRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/cal/:file',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { file } = z.object({ file: z.string().max(100) }).parse(req.params);
      const m = /^([\w-]{40,64})\.ics$/.exec(file);
      const user = m ? await findUserByFeedToken(db, m[1]!) : undefined;
      if (!user) throw new ApiError('NOT_FOUND');

      const now = new Date();
      const [gigs, manual] = await Promise.all([
        listFeedGigs(
          db,
          user.id,
          new Date(now.getTime() - 60 * DAY),
          new Date(now.getTime() - 14 * DAY),
        ),
        listManualGigs(db, user.id, new Date(now.getTime() - 60 * DAY)),
      ]);
      const windows = await stageWindows(
        db,
        gigs.filter((g) => !g.cancelled),
      );
      const ics = buildIcs({
        timezone: user.timezone,
        gigs: gigs.map((g) => ({
          participationId: g.participation.id,
          title: g.event.title,
          venue: g.venue.name,
          address: g.venue.address,
          timezone: g.venue.timezone,
          startsAt: g.event.startsAt,
          endsAt: g.event.windowEndsAt,
          position: g.cancelled ? null : g.participation.position,
          stageStart: windows.get(g.participation.id)?.start ?? null,
          dayConfirmation: g.participation.dayConfirmation,
          cancelled: g.cancelled,
          updatedAt: new Date(
            Math.max(g.participation.updatedAt.getTime(), g.event.updatedAt.getTime()),
          ),
        })),
        manual,
      });
      return reply
        .header('content-type', 'text/calendar; charset=utf-8')
        .header('cache-control', 'private, max-age=300')
        .send(ics);
    },
  );
};
