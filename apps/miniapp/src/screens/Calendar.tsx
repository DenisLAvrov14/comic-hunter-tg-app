import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ru, type CalendarBusy, type CalendarGig } from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import { formatTime, toLocalParts } from '../format';
import { haptic } from '../telegram';
import { BackButton, ErrorText, Screen, TextField } from '../ui';

const t = ru.app;
const c = t.calendar;
type Item = CalendarGig | CalendarBusy;

/** yyyy-MM-dd в таймзоне. */
const dayKey = (iso: string, tz: string) => toLocalParts(iso, tz).date;

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dayTitle(date: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** «Мой календарь»: лента по дням или месяц; ручная занятость — другим цветом. */
export function CalendarScreen() {
  const { me } = useMe();
  const tz = me.timezone;
  const today = toLocalParts(new Date().toISOString(), tz).date;
  const [mode, setMode] = useState<'feed' | 'month'>('feed');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Лента — 60 дней вперёд; месяц — с запасом по краям недель.
  const range = useMemo(() => {
    if (mode === 'feed') return { from: today, to: addDays(today, 60) };
    const first = `${month}-01`;
    return { from: addDays(first, -7), to: addDays(first, 42) };
  }, [mode, month, today]);
  const { data, error, isPending } = useQuery({
    queryKey: ['calendar', range.from, range.to],
    queryFn: () =>
      api.calendar(
        new Date(`${range.from}T00:00:00Z`).toISOString(),
        new Date(`${range.to}T23:59:59Z`).toISOString(),
      ),
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of data?.items ?? []) {
      const key = dayKey(item.startsAt, tz);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [data, tz]);

  return (
    <Screen title={c.title} back={<BackButton to="/" />}>
      <div className="tabs">
        {(['feed', 'month'] as const).map((m) => (
          <button key={m} className={mode === m ? 'tab active' : 'tab'} onClick={() => setMode(m)}>
            {c[m]}
          </button>
        ))}
      </div>

      {isPending ? (
        <p className="hint">{t.loading}</p>
      ) : error ? (
        <ErrorText error={error} />
      ) : mode === 'month' ? (
        <>
          <MonthGrid
            month={month}
            today={today}
            byDay={byDay}
            selected={selected}
            onSelect={setSelected}
            onMonth={(delta) => {
              const d = new Date(`${month}-01T00:00:00Z`);
              d.setUTCMonth(d.getUTCMonth() + delta);
              setMonth(d.toISOString().slice(0, 7));
              setSelected(null);
            }}
          />
          {selected && <Day date={selected} items={byDay.get(selected) ?? []} tz={tz} />}
        </>
      ) : byDay.size === 0 ? (
        <p className="hint">{c.empty}</p>
      ) : (
        [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, items]) => <Day key={date} date={date} items={items} tz={tz} />)
      )}

      {adding ? (
        <BusyForm tz={tz} defaultDate={selected ?? today} onDone={() => setAdding(false)} />
      ) : (
        <button className="secondary" onClick={() => setAdding(true)}>
          + {c.addBusy}
        </button>
      )}
    </Screen>
  );
}

function Day({ date, items, tz }: { date: string; items: Item[]; tz: string }) {
  return (
    <section className="stack">
      <h2 className="day-title">{dayTitle(date)}</h2>
      {items.length === 0 && <p className="hint">{c.empty}</p>}
      {items.map((item) =>
        item.type === 'gig' ? (
          <GigCard key={item.participationId} gig={item} />
        ) : (
          <BusyCard key={item.id} busy={item} tz={tz} />
        ),
      )}
    </section>
  );
}

function GigCard({ gig }: { gig: CalendarGig }) {
  const tz = gig.timezone;
  const flags = [
    gig.position ? c.position(gig.position) : null,
    c.stage(formatTime(gig.stageStart, tz)),
    gig.dayConfirmation === 'confirmed'
      ? `✓ ${c.confirmed}`
      : gig.dayConfirmation === 'declined'
        ? `✕ ${c.declined}`
        : null,
    gig.autoAccepted ? c.autoAccepted : null,
  ].filter(Boolean);
  return (
    <Link className="event-card" to={`/events/${gig.eventId}`}>
      <span className="event-when">{formatTime(gig.startsAt, tz)}</span>
      <strong>{gig.title}</strong>
      <span className="hint">
        {gig.venue} · {gig.address}
      </span>
      <span className="hint">{flags.join(' · ')}</span>
    </Link>
  );
}

function BusyCard({ busy, tz }: { busy: CalendarBusy; tz: string }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api.deleteBusy(busy.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['calendar'] }),
  });
  return (
    <div className={`event-card ${busy.type === 'busy' ? 'busy' : 'manual'}`}>
      <span className="event-when">
        {formatTime(busy.startsAt, tz)}–{formatTime(busy.endsAt, tz)}
      </span>
      <strong>{busy.title || (busy.type === 'busy' ? c.busy : c.manualGig)}</strong>
      <span className="hint">
        {busy.type === 'busy' ? c.busy : c.manualGig}
        {busy.venueText ? ` · ${busy.venueText}` : ''}
      </span>
      <button
        className="link-button danger-text"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {c.remove}
      </button>
    </div>
  );
}

function MonthGrid({
  month,
  today,
  byDay,
  selected,
  onSelect,
  onMonth,
}: {
  month: string;
  today: string;
  byDay: Map<string, Item[]>;
  selected: string | null;
  onSelect: (d: string) => void;
  onMonth: (delta: number) => void;
}) {
  const first = `${month}-01`;
  // Сетка с понедельника.
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i - offset));
  const title = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${first}T00:00:00Z`));
  return (
    <section className="card">
      <div className="row">
        <button className="secondary" aria-label="prev" onClick={() => onMonth(-1)}>
          {c.prev}
        </button>
        <strong className="grow center-text">{title}</strong>
        <button className="secondary" aria-label="next" onClick={() => onMonth(1)}>
          {c.next}
        </button>
      </div>
      <div className="month">
        {c.weekdays.map((w) => (
          <span key={w} className="hint weekday">
            {w}
          </span>
        ))}
        {cells.map((d) => {
          const items = byDay.get(d) ?? [];
          const cls = [
            'cell',
            d.slice(0, 7) !== month ? 'other' : '',
            d === today ? 'today' : '',
            d === selected ? 'selected' : '',
          ].join(' ');
          return (
            <button key={d} className={cls} onClick={() => onSelect(d)}>
              <span>{Number(d.slice(8))}</span>
              <span className="dots">
                {items.slice(0, 3).map((it, i) => (
                  <i key={i} className={`dot ${it.type}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function BusyForm({
  tz,
  defaultDate,
  onDone,
}: {
  tz: string;
  defaultDate: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'busy' | 'manual_gig'>('busy');
  const [date, setDate] = useState(defaultDate);
  const [from, setFrom] = useState('19:00');
  const [to, setTo] = useState('22:00');
  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api.addBusy({
        kind,
        startsAtLocal: `${date}T${from}`,
        // Окончание раньше начала — значит, после полуночи.
        endsAtLocal: `${to > from ? date : addDays(date, 1)}T${to}`,
        title: title.trim() || null,
        venueText: kind === 'manual_gig' ? venue.trim() || null : null,
      }),
    onSuccess: () => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      onDone();
    },
    onError: () => haptic('error'),
  });
  return (
    <section className="card">
      <h2>{c.addBusy}</h2>
      <label>
        {c.kind}
        <select value={kind} onChange={(e) => setKind(e.target.value as 'busy' | 'manual_gig')}>
          <option value="busy">{c.busy}</option>
          <option value="manual_gig">{c.manualGig}</option>
        </select>
      </label>
      <label>
        {c.date}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <div className="row">
        <label>
          {c.from}
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          {c.to}
          <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <span className="field-hint">{t.eventForm.timezoneHint(tz)}</span>
      <TextField label={c.title_} optional value={title} onChange={setTitle} />
      {kind === 'manual_gig' && (
        <TextField label={c.venue} optional value={venue} onChange={setVenue} />
      )}
      <ErrorText error={add.error} />
      <div className="row">
        <button disabled={!date || !from || !to || add.isPending} onClick={() => add.mutate()}>
          {c.save}
        </button>
        <button className="secondary" onClick={onDone}>
          {t.back}
        </button>
      </div>
    </section>
  );
}
