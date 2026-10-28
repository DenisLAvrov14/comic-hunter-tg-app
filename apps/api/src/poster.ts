import { ru } from '@standup/shared';

export interface PosterInput {
  title: string;
  startsAt: Date;
  timezone: string;
  venue: { name: string; address: string };
  hosts: string[];
  /** Состав в порядке выхода. */
  lineup: Array<{ stageName: string; link: string | null }>;
  conditions: string;
}

/** «пятница, 6 ноября, 20:00» в таймзоне площадки. */
export function posterDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/** Текст для афиши: название, дата, площадка, ведущий, состав, условия. */
export function buildPosterText(p: PosterInput): string {
  const t = ru.poster;
  const blocks = [
    [
      t.title(p.title),
      t.when(posterDate(p.startsAt, p.timezone)),
      t.venue(p.venue.name, p.venue.address),
      ...(p.hosts.length ? [t.host(p.hosts.join(', '))] : []),
    ].join('\n'),
  ];
  if (p.lineup.length) {
    blocks.push(
      [t.lineup, ...p.lineup.map((l, i) => t.item(i + 1, l.stageName, l.link))].join('\n'),
    );
  }
  if (p.conditions.trim()) blocks.push(`${t.conditions}\n${p.conditions.trim()}`);
  return blocks.join('\n\n');
}
