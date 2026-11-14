// Тексты команд /schedule, /slots, /profile. Данные собирает bot.ts, здесь — только сборка текста.
import { formatDateTime } from '@standup/notify';
import { ru } from '@standup/shared';

const t = ru.bot;

/** Сколько дней вперёд показывают /schedule и /slots. */
export const SCHEDULE_DAYS = 14;
export const SLOTS_DAYS = 7;
/** Больше строк в одном сообщении не выводим — дальше ссылка на приложение. */
export const LIST_LIMIT = 15;

interface At {
  startsAt: Date;
  timezone: string;
}

export interface ScheduleGig extends At {
  title: string;
  venue: string;
  position: number | null;
}

export interface ScheduleManual extends At {
  title: string | null;
  venue: string | null;
}

export interface ScheduleEvent extends At {
  title: string;
  venue: string;
  accepted: number;
  slots: number;
  awaiting: number;
}

function limited(lines: string[]): string[] {
  if (lines.length <= LIST_LIMIT) return lines;
  return [...lines.slice(0, LIST_LIMIT), t.slots.more(lines.length - LIST_LIMIT)];
}

export function renderSchedule(data: {
  gigs: Array<ScheduleGig | (ScheduleManual & { manual: true })>;
  events: ScheduleEvent[] | null;
}): string {
  const parts = [t.schedule.title(SCHEDULE_DAYS)];
  const gigs = [...data.gigs].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (gigs.length) {
    parts.push(
      [
        t.schedule.gigs,
        ...limited(
          gigs.map((g) => {
            const when = formatDateTime(g.startsAt, g.timezone);
            if ('manual' in g) {
              const title = g.title || ru.ics.manualDefault;
              return `• ${when} — ${title}${g.venue ? `, ${g.venue}` : ''} (${t.schedule.manual})`;
            }
            const pos = g.position ? `, ${t.schedule.position(g.position)}` : '';
            return `• ${when} — ${g.title}, ${g.venue}${pos}`;
          }),
        ),
      ].join('\n'),
    );
  }
  if (data.events?.length) {
    parts.push(
      [
        t.schedule.events,
        ...limited(
          data.events.map((e) => {
            const awaiting = e.awaiting ? ` · ${t.schedule.awaiting(e.awaiting)}` : '';
            return `• ${formatDateTime(e.startsAt, e.timezone)} — ${e.title}, ${e.venue} · ${t.schedule.slots(e.accepted, e.slots)}${awaiting}`;
          }),
        ),
      ].join('\n'),
    );
  }
  if (parts.length === 1) parts.push(t.schedule.empty);
  return parts.join('\n\n');
}

export interface SlotEvent extends At {
  title: string;
  venue: string;
  free: number;
}

/** Свободные места: только события, где места ещё есть. */
export function renderSlots(title: string, events: SlotEvent[]): string {
  const open = events.filter((e) => e.free > 0);
  if (open.length === 0) return `${title}\n\n${t.slots.empty}`;
  const lines = open.map(
    (e) =>
      `• ${formatDateTime(e.startsAt, e.timezone)} — ${e.title}, ${e.venue} · ${t.slots.free(e.free)}`,
  );
  return `${title}\n\n${limited(lines).join('\n')}`;
}

export interface ProfileView {
  comedian: {
    stageName: string;
    city: string;
    category: string;
    contact: string;
    bio: string | null;
    links: Array<{ label: string; url: string }>;
    photos: number;
  } | null;
  organizer: {
    displayName: string;
    city: string;
    projectName: string | null;
    contact: string | null;
  } | null;
}

export function renderProfile(p: ProfileView): string {
  const parts: string[] = [];
  if (p.comedian) {
    const c = p.comedian;
    parts.push(
      [
        `🎤 ${c.stageName} — ${t.profile.comedian}`,
        t.profile.city(c.city),
        t.profile.category(c.category),
        t.profile.contact(c.contact),
        c.bio,
        c.links.length
          ? [t.profile.links, ...c.links.map((l) => `• ${l.label}: ${l.url}`)].join('\n')
          : null,
        t.profile.photos(c.photos),
      ]
        .filter((x): x is string => !!x)
        .join('\n'),
    );
  }
  if (p.organizer) {
    const o = p.organizer;
    parts.push(
      [
        `📋 ${o.displayName} — ${t.profile.organizer}`,
        t.profile.city(o.city),
        o.projectName ? t.profile.project(o.projectName) : null,
        o.contact ? t.profile.contact(o.contact) : null,
      ]
        .filter((x): x is string => !!x)
        .join('\n'),
    );
  }
  return parts.length ? parts.join('\n\n') : t.profile.none;
}
