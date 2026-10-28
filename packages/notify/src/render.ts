// Текст сообщения собирается в момент отправки из актуальных данных:
// если повод исчез (подтвердил, событие отменено), уведомление пропускается.
import {
  and,
  eq,
  schema,
  type DbOrTx,
  type Event,
  type Participation,
  type ScheduledNotification,
  type User,
  type Venue,
} from '@standup/db';
import { computeSlotWindows, localDate } from '@standup/domain';
import { ru } from '@standup/shared';
import { dateTime, time } from './format';
import { appLink, type LinkConfig } from './links';
import type { InlineButton, OutgoingMessage } from './sender';

const { participations, events, venues, comedianProfiles, organizerProfiles, users } = schema;
const t = ru.notify;

export type Rendered =
  { message: OutgoingMessage; payload?: Record<string, unknown> } | { skip: string };

interface Gig {
  p: Participation;
  event: Event;
  venue: Venue;
}

async function loadGig(db: DbOrTx, participationId: string): Promise<Gig | undefined> {
  const [row] = await db
    .select({ p: participations, event: events, venue: venues })
    .from(participations)
    .innerJoin(events, eq(events.id, participations.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(eq(participations.id, participationId));
  return row;
}

async function loadEvent(db: DbOrTx, eventId: string) {
  const [row] = await db
    .select({ event: events, venue: venues })
    .from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(eq(events.id, eventId));
  return row;
}

/** Строка о выступлении: название, площадка, время, номер и примерный выход. */
export async function gigLine(db: DbOrTx, g: Gig): Promise<string> {
  const tz = g.venue.timezone;
  let stage: string | null = null;
  if (g.p.status === 'accepted' && g.p.position !== null) {
    const lineup = await db
      .select({
        id: participations.id,
        position: participations.position,
        setMinutesOverride: participations.setMinutesOverride,
      })
      .from(participations)
      .where(and(eq(participations.eventId, g.event.id), eq(participations.status, 'accepted')));
    const w = computeSlotWindows(g.event, lineup).get(g.p.id);
    if (w) stage = time(w.start, tz);
  }
  return t.gig(
    g.event.title,
    g.venue.name,
    dateTime(g.event.startsAt, tz),
    g.p.status === 'accepted' ? g.p.position : null,
    stage,
  );
}

function eventLine(e: { event: Event; venue: Venue }) {
  return `🎤 ${e.event.title} — ${e.venue.name}, ${e.venue.address}\n${dateTime(e.event.startsAt, e.venue.timezone)}`;
}

async function comedianName(db: DbOrTx, userId: string) {
  const [row] = await db
    .select({
      name: comedianProfiles.stageName,
      contact: comedianProfiles.contact,
      first: users.firstName,
    })
    .from(users)
    .leftJoin(comedianProfiles, eq(comedianProfiles.userId, users.id))
    .where(eq(users.id, userId));
  return { name: row?.name ?? row?.first ?? '—', contact: row?.contact ?? '—' };
}

async function organizerName(db: DbOrTx, userId: string) {
  const [row] = await db
    .select({
      name: organizerProfiles.displayName,
      project: organizerProfiles.projectName,
      first: users.firstName,
    })
    .from(users)
    .leftJoin(organizerProfiles, eq(organizerProfiles.userId, users.id))
    .where(eq(users.id, userId));
  const name = row?.name ?? row?.first ?? '—';
  return row?.project ? `${name} (${row.project})` : name;
}

function openButton(links: LinkConfig, startParam: string): InlineButton[] {
  const url = appLink(links, startParam);
  return url ? [{ text: t.open, url }] : [];
}

const ended = (e: Event) => e.status === 'cancelled' || e.status === 'finished';

/** Все принятые выступления пользователя в его календарный день `date`. */
export async function gigsOnDate(db: DbOrTx, user: User, date: string): Promise<Gig[]> {
  const rows = await db
    .select({ p: participations, event: events, venue: venues })
    .from(participations)
    .innerJoin(events, eq(events.id, participations.eventId))
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(participations.comedianId, user.id), eq(participations.status, 'accepted')));
  return rows
    .filter((r) => !ended(r.event) && localDate(r.event.startsAt, user.timezone) === date)
    .sort((a, b) => a.event.startsAt.getTime() - b.event.startsAt.getTime());
}

/** Дайджест на день: выступления и кнопки подтверждения (по одной паре на выступление). */
export async function renderDigest(
  db: DbOrTx,
  user: User,
  date: string,
  opts: { repeat: boolean },
): Promise<Rendered> {
  let gigs = await gigsOnDate(db, user, date);
  if (opts.repeat) gigs = gigs.filter((g) => g.p.dayConfirmation === 'none');
  if (gigs.length === 0) return { skip: opts.repeat ? 'all_confirmed' : 'no_gigs' };

  const lines = await Promise.all(gigs.map((g) => gigLine(db, g)));
  const buttons: InlineButton[][] = gigs
    .filter((g) => g.p.dayConfirmation === 'none')
    .map((g) =>
      gigs.length === 1
        ? [
            { text: t.confirm, callbackData: `dc:${g.p.id}:y` },
            { text: t.cantCome, callbackData: `dc:${g.p.id}:n` },
          ]
        : [
            { text: t.confirmOne(g.event.title), callbackData: `dc:${g.p.id}:y` },
            { text: t.cantComeOne(g.event.title), callbackData: `dc:${g.p.id}:n` },
          ],
    );
  const text = (opts.repeat ? t.digestRepeat : t.digest)(lines.join('\n\n'));
  return {
    message: { chatId: user.telegramId, text, buttons },
    payload: { participationIds: gigs.map((g) => g.p.id) },
  };
}

export async function renderNotification(
  db: DbOrTx,
  n: ScheduledNotification,
  links: LinkConfig,
): Promise<Rendered> {
  const [user] = await db.select().from(users).where(eq(users.id, n.userId));
  if (!user) return { skip: 'no_user' };
  if (!user.botStarted || user.botBlocked) return { skip: 'bot_unavailable' };
  const chatId = user.telegramId;
  const msg = (text: string, buttons: InlineButton[][] = []): Rendered => ({
    message: { chatId, text, buttons: buttons.filter((r) => r.length > 0) },
  });

  if (n.kind === 'day_digest' || n.kind === 'day_digest_repeat') {
    return renderDigest(db, user, String(n.payload.date), {
      repeat: n.kind === 'day_digest_repeat',
    });
  }

  if (
    n.kind === 'broadcast' ||
    n.kind === 'new_application' ||
    n.kind === 'event_cancelled' ||
    n.kind === 'event_changed'
  ) {
    const e = n.eventId ? await loadEvent(db, n.eventId) : undefined;
    if (!e) return { skip: 'no_event' };
    const open = openButton(links, `e_${e.event.id}`);
    switch (n.kind) {
      case 'broadcast':
        return msg(ru.messages.broadcast(e.event.title, String(n.payload.text ?? '')), [open]);
      case 'event_cancelled':
        return msg(t.eventCancelled(eventLine(e)));
      case 'event_changed':
        if (ended(e.event)) return { skip: 'event_ended' };
        return msg(t.eventChanged(eventLine(e)), [open]);
      default: {
        const pending = await db
          .select({ id: participations.id })
          .from(participations)
          .where(and(eq(participations.eventId, e.event.id), eq(participations.status, 'pending')));
        if (pending.length === 0) return { skip: 'no_applications' };
        return msg(t.newApplications(pending.length, eventLine(e)), [open]);
      }
    }
  }

  const g = n.participationId ? await loadGig(db, n.participationId) : undefined;
  if (!g) return { skip: 'no_participation' };
  if (ended(g.event)) return { skip: 'event_ended' };
  const gig = await gigLine(db, g);
  const open = openButton(links, `e_${g.event.id}`);
  const p = g.p;

  switch (n.kind) {
    case 'unconfirmed_alert':
    case 'withdrawal_alert': {
      if (p.status !== 'accepted') return { skip: 'not_in_lineup' };
      if (n.kind === 'unconfirmed_alert' && p.dayConfirmation !== 'none')
        return { skip: 'answered' };
      const c = await comedianName(db, p.comedianId);
      const text = (n.kind === 'unconfirmed_alert' ? t.unconfirmed : t.withdrawal)(
        c.name,
        c.contact,
        gig,
      );
      return msg(text, [[{ text: t.callReserve, callbackData: `rr:${p.id}` }], open]);
    }
    case 'pre_show_reminder':
      if (p.status !== 'accepted' || p.dayConfirmation === 'declined')
        return { skip: 'not_in_lineup' };
      return msg(t.preShow(user.preShowMinutes ?? 30, gig), [open]);
    case 'invitation_received': {
      if (p.status !== 'invited') return { skip: 'answered' };
      const reason = n.payload.autoAcceptReason as string | undefined;
      const why = reason ? t.autoAcceptFailed(t.autoAcceptReasons[reason] ?? reason) : '';
      return msg(t.invitation(await organizerName(db, g.event.organizerId), gig, p.message) + why, [
        [
          { text: t.accept, callbackData: `iv:${p.id}:a` },
          { text: t.decline, callbackData: `iv:${p.id}:d` },
        ],
        open,
      ]);
    }
    case 'invitation_auto_accepted':
      if (p.status !== 'accepted') return { skip: 'not_in_lineup' };
      return msg(t.autoAccepted(gig), [open]);
    case 'replacement_request':
      if (p.status !== 'reserve' || !p.isUrgent) return { skip: 'answered' };
      return msg(
        ru.messages.replacement(
          g.event.title,
          dateTime(g.event.startsAt, g.venue.timezone),
          g.venue.name,
        ),
        [
          [
            { text: t.accept, callbackData: `iv:${p.id}:a` },
            { text: t.decline, callbackData: `iv:${p.id}:d` },
          ],
          open,
        ],
      );
    case 'application_accepted':
      return msg(t.applicationAccepted(gig), [open]);
    case 'application_rejected':
      return msg(t.applicationRejected(gig), [open]);
    case 'moved_to_reserve':
      return msg(t.movedToReserve(gig), [open]);
    case 'promoted_from_reserve':
      return msg(t.promoted(gig), [open]);
    case 'removed_from_lineup':
      return msg(t.removed(gig));
    case 'lineup_position_changed':
      if (p.status !== 'accepted') return { skip: 'not_in_lineup' };
      return msg(t.positionChanged(gig), [open]);
    case 'counter_proposal_received': {
      if (p.status !== 'counter_proposed') return { skip: 'answered' };
      const c = await comedianName(db, p.comedianId);
      return msg(t.counterProposal(c.name, p.counterProposal ?? '', gig), [open]);
    }
    default:
      return { skip: `unknown_kind:${n.kind}` };
  }
}
