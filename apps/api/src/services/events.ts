import { randomBytes } from 'node:crypto';
import {
  findComedians,
  findEventWithRefs,
  findStaff,
  findUserParticipation,
  listAcceptedForEvents,
  listBusySlotsInRange,
  listComedianGigsInRange,
  listEventParticipations,
  type ComedianRow,
  type DbOrTx,
  type Event,
  type EventWithRefs,
  type Participation,
} from '@standup/db';
import {
  can,
  computeSlotWindows,
  eventWindow,
  expand,
  findConflicts,
  type Commitment,
  type EventResource,
  type Window,
} from '@standup/domain';
import type {
  ComedianBrief,
  EventDetails,
  EventSummary,
  Lineup,
  LineupItem,
  MyParticipation,
  ScheduleConflict,
} from '@standup/shared';
import { ApiError } from '../errors';
import type { FileStorage } from '../storage';

/** Криптостойкий токен ссылки набора (128 бит, base64url). */
export function newLinkToken(): string {
  return randomBytes(16).toString('base64url');
}

export function windowEnd(
  e: Pick<Event, 'startsAt' | 'endsAt' | 'slotsCount' | 'setMinutes' | 'gapMinutes'>,
) {
  return eventWindow(e).end;
}

export function toEventSummary(r: EventWithRefs): EventSummary {
  return {
    id: r.event.id,
    title: r.event.title,
    format: r.event.format,
    formatNote: r.event.formatNote,
    status: r.event.status,
    startsAt: r.event.startsAt.toISOString(),
    endsAt: r.event.endsAt?.toISOString() ?? null,
    windowEndsAt: r.event.windowEndsAt.toISOString(),
    timezone: r.venue.timezone,
    venue: { id: r.venue.id, name: r.venue.name, address: r.venue.address, cityId: r.venue.cityId },
    organizer: {
      id: r.organizer.userId,
      displayName: r.organizer.displayName,
      projectName: r.organizer.projectName,
    },
    slotsCount: r.event.slotsCount,
    acceptedCount: r.acceptedCount,
    recruitmentOpen: r.event.recruitmentOpen,
  };
}

export function toMyParticipation(p: Participation): MyParticipation {
  return {
    id: p.id,
    status: p.status,
    source: p.source,
    position: p.position,
    autoAccepted: p.autoAccepted,
    isUrgent: p.isUrgent,
    counterProposal: p.counterProposal,
  };
}

/** Ресурс для can(): событие + штат + участие пользователя. */
export async function eventResource(
  db: DbOrTx,
  event: Event,
  userId: string,
  opts: { viaLink?: boolean } = {},
): Promise<EventResource & { participationRow: Participation | null }> {
  const [staff, participation] = await Promise.all([
    findStaff(db, event.id, userId),
    findUserParticipation(db, event.id, userId),
  ]);
  return {
    event: {
      organizerId: event.organizerId,
      status: event.status,
      recruitmentOpen: event.recruitmentOpen,
    },
    staff: staff ? { permissions: staff.permissions } : null,
    participation: participation ? { status: participation.status } : null,
    participationRow: participation ?? null,
    viaLink: opts.viaLink,
  };
}

export async function loadEventDetails(
  db: DbOrTx,
  userId: string,
  eventId: string,
  opts: { viaLink?: boolean } = {},
): Promise<EventDetails> {
  const row = await findEventWithRefs(db, eventId);
  if (!row) throw new ApiError('NOT_FOUND');
  const resource = await eventResource(db, row.event, userId, opts);
  if (!can({ userId }, 'event.view', resource)) throw new ApiError('NOT_FOUND');

  const isOrganizer = row.event.organizerId === userId;
  let lineup: EventDetails['lineup'] = null;
  if (row.event.showLineup || isOrganizer || resource.staff) {
    const accepted = (await listEventParticipations(db, eventId)).filter(
      (p) => p.status === 'accepted' && p.position !== null,
    );
    const names = new Map(
      (
        await findComedians(
          db,
          accepted.map((p) => p.comedianId),
        )
      ).map((c) => [c.userId, c.stageName]),
    );
    lineup = accepted
      .sort((a, b) => a.position! - b.position!)
      .map((p) => ({ position: p.position!, stageName: names.get(p.comedianId) ?? '—' }));
  }

  return {
    ...toEventSummary(row),
    setMinutes: row.event.setMinutes,
    gapMinutes: row.event.gapMinutes,
    conditions: row.event.conditions,
    showLineup: row.event.showLineup,
    lineupVersion: row.event.lineupVersion,
    viewer: {
      isOrganizer,
      canApply: can({ userId }, 'event.apply', resource),
      participation: resource.participationRow
        ? toMyParticipation(resource.participationRow)
        : null,
    },
    linkToken: isOrganizer ? row.event.recruitmentLinkToken : null,
    lineup,
  };
}

// --- Пересечения ---

/**
 * Пересечения окна выступления комика с его другими accepted-выступлениями и занятостью.
 * Кандидатов ищем в БД через tstzrange &&, точные окна на сцене — доменными функциями.
 */
export async function scheduleConflicts(
  db: DbOrTx,
  comedian: Pick<ComedianRow, 'userId' | 'travelBufferMinutes'>,
  eventId: string,
  candidate: Window,
): Promise<ScheduleConflict[]> {
  const buffer = comedian.travelBufferMinutes;
  const range = expand(candidate, buffer);
  const [gigs, busy] = await Promise.all([
    listComedianGigsInRange(db, comedian.userId, range.start, range.end, eventId),
    listBusySlotsInRange(db, comedian.userId, range.start, range.end),
  ]);

  const lineups = await listAcceptedForEvents(
    db,
    gigs.map((g) => g.event.id),
  );
  const commitments: Commitment<ScheduleConflict>[] = [];
  for (const g of gigs) {
    const windows = computeSlotWindows(
      g.event,
      lineups.filter((l) => l.eventId === g.event.id),
    );
    const w = windows.get(g.participation.id) ?? eventWindow(g.event);
    commitments.push({
      window: w,
      kind: 'gig',
      ref: {
        kind: 'gig',
        title: g.event.title,
        venue: g.venue.name,
        start: w.start.toISOString(),
        end: w.end.toISOString(),
        timezone: g.venue.timezone,
      },
    });
  }
  for (const b of busy) {
    commitments.push({
      window: { start: b.startsAt, end: b.endsAt },
      kind: b.kind,
      ref: {
        kind: b.kind,
        title: b.title ?? '',
        venue: b.venueText,
        start: b.startsAt.toISOString(),
        end: b.endsAt.toISOString(),
        // TODO(spec): у busy_slots нет таймзоны — показываем в таймзоне события-кандидата.
        timezone: '',
      },
    });
  }
  return findConflicts(candidate, buffer, commitments).map((c) => c.ref);
}

// --- Состав ---

export function toComedianBrief(storage: FileStorage, c: ComedianRow): ComedianBrief {
  return {
    id: c.userId,
    stageName: c.stageName,
    category: c.category,
    contact: c.contact,
    photoUrl: c.photoKey ? storage.publicUrl(c.photoKey) : null,
  };
}

const conflictCheckedStatuses = new Set<Participation['status']>([
  'pending',
  'invited',
  'counter_proposed',
  'reserve',
]);

export async function loadLineup(
  db: DbOrTx,
  storage: FileStorage,
  event: Event,
  timezone: string,
): Promise<Lineup> {
  const all = await listEventParticipations(db, event.id);
  const comedians = new Map(
    (
      await findComedians(
        db,
        all.map((p) => p.comedianId),
      )
    ).map((c) => [c.userId, c]),
  );
  const accepted = all.filter((p) => p.status === 'accepted');
  const windows = computeSlotWindows(event, accepted);
  const whole = eventWindow(event);

  const items = await Promise.all(
    all.map(async (p): Promise<LineupItem> => {
      const c = comedians.get(p.comedianId);
      const brief: ComedianBrief = c
        ? toComedianBrief(storage, c)
        : { id: p.comedianId, stageName: '—', category: 'newbie', contact: '', photoUrl: null };
      // Для ещё не принятых показываем, с чем пересечётся всё событие.
      const conflicts =
        c && conflictCheckedStatuses.has(p.status)
          ? (await scheduleConflicts(db, c, event.id, whole)).map((x) => ({
              ...x,
              timezone: x.timezone || timezone,
            }))
          : [];
      const w = p.status === 'accepted' && p.position !== null ? windows.get(p.id) : undefined;
      return {
        id: p.id,
        status: p.status,
        source: p.source,
        position: p.position,
        autoAccepted: p.autoAccepted,
        isUrgent: p.isUrgent,
        message: p.message,
        counterProposal: p.counterProposal,
        comedian: brief,
        stageStart: w ? w.start.toISOString() : null,
        conflicts,
      };
    }),
  );

  const by = (...statuses: Participation['status'][]) =>
    items.filter((i) => statuses.includes(i.status));
  return {
    version: event.lineupVersion,
    accepted: by('accepted').sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9)),
    reserve: by('reserve'),
    applications: by('pending'),
    invitations: by('invited', 'counter_proposed'),
    closed: by('rejected', 'declined', 'withdrawn', 'removed'),
  };
}
