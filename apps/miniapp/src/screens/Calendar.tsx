import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ru, type CalendarBusy, type CalendarGig, type ScheduleConflict } from '@standup/shared';
import { api, ApiRequestError } from '../api';
import { ConflictList } from '../events-ui';
import { useMe } from '../auth';
import { formatDateTime, formatTime, toLocalParts } from '../format';
import { haptic } from '../telegram';
import { CitySelect, ErrorText, MissingText, Screen, TextField, useRequired } from '../ui';

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
  const [mode, setMode] = useState<'feed' | 'month'>('month');
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
    <Screen title={c.title}>
      {mode === 'feed' && data && <NextGig items={data.items} tz={tz} />}
      <div className="tabs">
        {(['month', 'feed'] as const).map((m) => (
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
        <GigForm
          tz={tz}
          cityId={me.comedianProfile?.cityId ?? null}
          defaultDate={selected ?? today}
          onDone={() => setAdding(false)}
        />
      ) : (
        <button className="secondary" onClick={() => setAdding(true)}>
          + {c.addGig}
        </button>
      )}
    </Screen>
  );
}

/** Ближайшее своё выступление: то, ради чего чаще всего открывают приложение. */
function NextGig({ items, tz }: { items: Item[]; tz: string }) {
  const now = Date.now();
  const next = items.find((i) => i.type !== 'busy' && new Date(i.endsAt).getTime() > now);
  if (!next || next.type === 'busy') return null;
  const body = (zone: string, place: string | null) => (
    <>
      <small>
        {c.nextGig}
        {next.type !== 'gig' ? ` · ${c.manualTag}` : ''}
      </small>
      <strong>{next.title ?? c.manualGig}</strong>
      <span>
        {formatDateTime(next.startsAt, zone)}
        {place ? ` · ${place}` : ''}
      </span>
    </>
  );
  return next.type === 'gig' ? (
    <Link className="next-gig" to={`/events/${next.eventId}`}>
      {body(next.timezone, next.venue)}
    </Link>
  ) : (
    <div className="next-gig">{body(tz, next.venueText)}</div>
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
  const kind = busy.type === 'busy' ? c.busy : c.manualGig;
  // Название (или вид записи, если названия нет), под ним — только площадка.
  const details = busy.venueText;
  return (
    <div className={`event-card ${busy.type === 'busy' ? 'busy' : 'manual'}`}>
      <span className="event-head">
        <span className="event-when">
          {formatTime(busy.startsAt, tz)}–{formatTime(busy.endsAt, tz)}
        </span>
        {/* Своё выступление не связано с событиями организаторов — помечаем, чтобы не путать. */}
        {busy.type === 'manual_gig' && <span className="tag">{c.manualTag}</span>}
      </span>
      <strong>{busy.title || kind}</strong>
      {details && <span className="hint">{details}</span>}
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
      <div className="month-nav">
        <button className="nav-arrow" aria-label="prev" onClick={() => onMonth(-1)}>
          {c.prev}
        </button>
        <strong className="center-text">{title}</strong>
        <button className="nav-arrow" aria-label="next" onClick={() => onMonth(1)}>
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

/** Своё выступление закрывает в календаре два часа от начала. */
const GIG_HOURS = 2;
const OTHER = 'other';

/** Своё выступление вне приложения: площадка из списка (или своя), дата и время. */
function GigForm({
  tz,
  cityId: profileCity,
  defaultDate,
  onDone,
}: {
  tz: string;
  cityId: number | null;
  defaultDate: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [cityId, setCityId] = useState(profileCity);
  const [venueId, setVenueId] = useState('');
  const [otherVenue, setOtherVenue] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [from, setFrom] = useState('20:00');
  const [title, setTitle] = useState('');
  const venues = useQuery({
    queryKey: ['venues', cityId],
    queryFn: () => api.venues(cityId!),
    enabled: cityId !== null,
  });
  const venueName =
    venueId === OTHER
      ? otherVenue.trim()
      : (venues.data?.find((v) => v.id === venueId)?.name ?? '');

  const required = useRequired([
    [c.venue, venueId !== ''],
    [c.otherVenueName, venueId !== OTHER || otherVenue.trim() !== ''],
    [c.date, date !== ''],
    [c.from, from !== ''],
  ]);
  const add = useMutation({
    mutationFn: () => {
      const [h, m] = from.split(':').map(Number) as [number, number];
      const endHour = h + GIG_HOURS;
      const end = `${String(endHour % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      return api.addBusy({
        kind: 'manual_gig',
        startsAtLocal: `${date}T${from}`,
        endsAtLocal: `${endHour >= 24 ? addDays(date, 1) : date}T${end}`,
        title: title.trim() || null,
        venueText: venueName || null,
      });
    },
    onSuccess: () => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      onDone();
    },
    onError: () => haptic('error'),
  });
  return (
    <section className="card">
      <h2>{c.addGig}</h2>
      <CitySelect
        value={cityId}
        onChange={(id) => {
          setCityId(id);
          setVenueId('');
        }}
      />
      <label className={required.isMissing(c.venue) ? 'invalid' : undefined}>
        {c.venue}
        <select value={venueId} onChange={(e) => setVenueId(e.target.value)}>
          <option value="" disabled>
            {c.venuePlaceholder}
          </option>
          {venues.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
          <option value={OTHER}>{c.otherVenue}</option>
        </select>
      </label>
      {venueId === OTHER && (
        <TextField
          label={c.otherVenueName}
          value={otherVenue}
          invalid={required.isMissing(c.otherVenueName)}
          onChange={setOtherVenue}
        />
      )}
      <div className="fields">
        <label className={required.isMissing(c.date) ? 'invalid' : undefined}>
          {c.date}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className={required.isMissing(c.from) ? 'invalid' : undefined}>
          {c.from}
          <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
      </div>
      <span className="field-hint">{t.eventForm.timezoneHint(tz)}</span>
      <TextField label={c.title_} optional value={title} onChange={setTitle} />
      <MissingText missing={required.missing} />
      {add.error instanceof ApiRequestError && add.error.code === 'CONFLICT_SCHEDULE' ? (
        <ConflictList
          conflicts={(add.error.details as { conflicts?: ScheduleConflict[] })?.conflicts ?? []}
          timezone={tz}
        />
      ) : (
        <ErrorText error={add.error} />
      )}
      <div className="action-bar">
        <button disabled={add.isPending} onClick={() => required.check() && add.mutate()}>
          {c.save}
        </button>
        <button className="outline" onClick={onDone}>
          {t.back}
        </button>
      </div>
    </section>
  );
}
