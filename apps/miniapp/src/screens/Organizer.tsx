import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COMEDIAN_SEARCH_LIMIT,
  comedianCategories,
  ru,
  selectableEventFormats,
  type ComedianCategory,
  type ComedianSearchItem,
  type EventDetails,
  type EventFormat,
  type EventInput,
} from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import { ComedianCardView } from '../comedian-card';
import { EventCard } from '../events-ui';
import { formatDayRange, toLocalParts, todayLocal } from '../format';
import { haptic } from '../telegram';
import {
  BackButton,
  CitySelect,
  ErrorText,
  MainButton,
  MissingText,
  Screen,
  TextField,
  useCities,
  useRequired,
} from '../ui';
import { Select } from '../select';

const t = ru.app;

export function MyEventsScreen() {
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const { data, error, isPending } = useQuery({
    queryKey: ['events', 'mine', when],
    queryFn: () => api.myEvents(when),
  });
  return (
    <Screen title={t.myEvents.title}>
      <div className="tabs">
        {(['upcoming', 'past'] as const).map((w) => (
          <button key={w} className={when === w ? 'tab active' : 'tab'} onClick={() => setWhen(w)}>
            {t.myEvents[w]}
          </button>
        ))}
      </div>
      {isPending ? (
        <p className="hint">{t.loading}</p>
      ) : error ? (
        <ErrorText error={error} />
      ) : data.length === 0 ? (
        <p className="hint">{t.myEvents.empty}</p>
      ) : (
        <div className="list">
          {data.map((e) => (
            <EventCard
              key={e.id}
              e={e}
              to={`/events/${e.id}/manage`}
              badge={when === 'upcoming' ? e.awaitingCount : 0}
            />
          ))}
        </div>
      )}
      <Link className="button-link" to="/events/new">
        + {t.myEvents.create}
      </Link>
    </Screen>
  );
}

interface EventDraft {
  venueId: string;
  title: string;
  format: EventFormat;
  formatNote: string;
  date: string;
  startTime: string;
  /** Конец и паузу в форме не спрашиваем; у старых событий значения сохраняются. */
  endTime: string;
  slotsCount: string;
  setMinutes: string;
  gapMinutes: string;
  conditions: string;
  recruitmentOpen: boolean;
  showLineup: boolean;
}

function draftFrom(e?: EventDetails): EventDraft {
  if (!e) {
    return {
      venueId: '',
      title: '',
      format: 'open_mic',
      formatNote: '',
      date: todayLocal(),
      startTime: '20:00',
      endTime: '',
      slotsCount: '8',
      setMinutes: '7',
      gapMinutes: '0',
      conditions: '',
      recruitmentOpen: true,
      showLineup: true,
    };
  }
  const start = toLocalParts(e.startsAt, e.timezone);
  return {
    venueId: e.venue.id,
    title: e.title,
    format: e.format,
    formatNote: e.formatNote ?? '',
    date: start.date,
    startTime: start.time,
    endTime: e.endsAt ? toLocalParts(e.endsAt, e.timezone).time : '',
    slotsCount: String(e.slotsCount),
    setMinutes: String(e.setMinutes),
    gapMinutes: String(e.gapMinutes),
    conditions: e.conditions,
    recruitmentOpen: e.recruitmentOpen,
    showLineup: e.showLineup,
  };
}

/** Окончание раньше начала — значит, после полуночи: следующий день. */
function endLocal(d: EventDraft): string | null {
  if (!d.endTime) return null;
  if (d.endTime > d.startTime) return `${d.date}T${d.endTime}`;
  const next = new Date(`${d.date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.toISOString().slice(0, 10)}T${d.endTime}`;
}

function toInput(d: EventDraft): Omit<EventInput, 'status'> {
  return {
    venueId: d.venueId,
    title: d.title.trim(),
    format: d.format,
    formatNote: d.formatNote.trim() || null,
    startsAtLocal: `${d.date}T${d.startTime}`,
    endsAtLocal: endLocal(d),
    slotsCount: Number(d.slotsCount),
    setMinutes: Number(d.setMinutes),
    gapMinutes: Number(d.gapMinutes),
    conditions: d.conditions.trim(),
    recruitmentOpen: d.recruitmentOpen,
    showLineup: d.showLineup,
  };
}

/** /events/new и /events/:id/edit */
export function EventFormScreen() {
  const { id } = useParams();
  const existing = useQuery({
    queryKey: ['event', id],
    queryFn: () => api.event(id!),
    enabled: !!id,
  });
  if (id && existing.isPending) return <p className="center hint">{t.loading}</p>;
  if (id && !existing.data) return <p className="center hint">{t.events.notFound}</p>;
  return <EventForm event={existing.data} />;
}

function EventForm({ event }: { event?: EventDetails }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [d, setD] = useState(() => draftFrom(event));
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setD({ ...d, [k]: v });
  const [cityId, setCityId] = useState(event?.venue.cityId ?? me.organizerProfile?.cityId ?? null);
  const venues = useQuery({
    queryKey: ['venues', cityId],
    queryFn: () => api.venues(cityId!),
    enabled: cityId !== null,
  });
  const venue = venues.data?.find((v) => v.id === d.venueId);

  const save = useMutation({
    mutationFn: (status: 'draft' | 'recruiting' | undefined) =>
      event ? api.updateEvent(event.id, toInput(d)) : api.createEvent({ ...toInput(d), status }),
    onSuccess: (saved) => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.setQueryData(['event', saved.id], saved);
      navigate(`/events/${saved.id}/manage`, { replace: true });
    },
    onError: () => haptic('error'),
  });

  const f = t.eventForm;
  const required = useRequired([
    [f.title, d.title.trim() !== ''],
    [t.fields.city, cityId !== null],
    [f.venue, d.venueId !== ''],
    [f.date, d.date !== ''],
    [f.startTime, d.startTime !== ''],
    [f.slots, Number(d.slotsCount) > 0],
    [f.setMinutes, Number(d.setMinutes) > 0],
  ]);
  const submit = (status: 'draft' | 'recruiting' | undefined) => {
    if (required.check()) save.mutate(status);
  };
  const num = (k: 'slotsCount' | 'setMinutes') => (v: string) => set(k, v.replace(/\D/g, ''));

  return (
    <Screen title={event ? t.eventForm.editTitle : t.eventForm.createTitle} back={<BackButton />}>
      <section className="card">
        <TextField
          label={t.eventForm.title}
          value={d.title}
          invalid={required.isMissing(f.title)}
          onChange={(v) => set('title', v)}
        />
        <CitySelect
          value={cityId}
          invalid={required.isMissing(t.fields.city)}
          onChange={(id) => {
            setCityId(id);
            set('venueId', '');
          }}
        />
        <label className={required.isMissing(f.venue) ? 'invalid' : undefined}>
          {t.eventForm.venue}
          <Select value={d.venueId} onChange={(v) => set('venueId', v)}>
            <option value="" disabled>
              {t.eventForm.venuePlaceholder}
            </option>
            {venues.data?.map((v) => (
              // Отклонённую площадку нельзя выбрать, но в своём событии она остаётся.
              <option
                key={v.id}
                value={v.id}
                disabled={v.status === 'rejected' && v.id !== event?.venue.id}
              >
                {v.name} — {v.address}
                {v.status !== 'approved' &&
                  ` · ${v.status === 'rejected' ? t.venues.rejected : t.venues.pending}`}
              </option>
            ))}
          </Select>
          {venues.data?.length === 0 && (
            <span className="field-hint">
              <Link to="/venues">{t.eventForm.noVenues}</Link>
            </span>
          )}
        </label>
        <label>
          {t.eventForm.format}
          <Select value={d.format} onChange={(v) => set('format', v as EventFormat)}>
            {selectableEventFormats.map((f) => (
              <option key={f} value={f}>
                {t.formatOptions[f]}
              </option>
            ))}
          </Select>
        </label>
        <TextField
          label={t.eventForm.formatNote}
          optional
          value={d.formatNote}
          onChange={(v) => set('formatNote', v)}
        />
      </section>

      <section className="card">
        <div className="fields">
          <label className={required.isMissing(f.date) ? 'invalid' : undefined}>
            {t.eventForm.date}
            <input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
          </label>
          <label className={required.isMissing(f.startTime) ? 'invalid' : undefined}>
            {t.eventForm.startTime}
            <input
              type="time"
              value={d.startTime}
              onChange={(e) => set('startTime', e.target.value)}
            />
          </label>
        </div>
        {venue && <span className="field-hint">{t.eventForm.timezoneHint(venue.timezone)}</span>}
        <div className="fields">
          <TextField
            label={t.eventForm.slots}
            inputMode="numeric"
            value={d.slotsCount}
            invalid={required.isMissing(f.slots)}
            onChange={num('slotsCount')}
          />
          <TextField
            label={t.eventForm.setMinutes}
            inputMode="numeric"
            value={d.setMinutes}
            invalid={required.isMissing(f.setMinutes)}
            onChange={num('setMinutes')}
          />
        </div>
      </section>

      <section className="card">
        <TextField
          label={t.eventForm.conditions}
          hint={t.eventForm.conditionsHint}
          optional
          multiline
          value={d.conditions}
          onChange={(v) => set('conditions', v)}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={d.recruitmentOpen}
            onChange={(e) => set('recruitmentOpen', e.target.checked)}
          />
          <span>{t.eventForm.recruitmentOpen}</span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={d.showLineup}
            onChange={(e) => set('showLineup', e.target.checked)}
          />
          <span>{t.eventForm.showLineup}</span>
        </label>
      </section>

      <MissingText missing={required.missing} />
      <ErrorText error={save.error} />
      {!event && (
        <button className="secondary" disabled={save.isPending} onClick={() => submit('draft')}>
          {t.eventForm.saveDraft}
        </button>
      )}
      <MainButton
        text={event ? t.eventForm.save : t.eventForm.publish}
        loading={save.isPending}
        onClick={() => submit(event ? undefined : 'recruiting')}
      />
    </Screen>
  );
}

/** Город проживания комика и поездка, если она относится к поиску. */
function ComedianSummary({ c }: { c: ComedianSearchItem }) {
  const { data: cities = [] } = useCities();
  const cityName = (id: number) => cities.find((x) => x.id === id)?.name ?? '';
  return (
    <span className="grow stack-tight">
      <strong>{c.stageName}</strong>
      <span className="hint">
        {t.categories[c.category]} · {cityName(c.cityId)}
      </span>
      {c.trip && (
        <span className="trip-note">
          {t.trips.note(cityName(c.trip.cityId), formatDayRange(c.trip.startsOn, c.trip.endsOn))}
        </span>
      )}
    </span>
  );
}

/** Вкладка организатора: все комики с фильтром; пригласить можно с экрана события. */
export function ComediansScreen() {
  const { me } = useMe();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<ComedianCategory | ''>('');
  const [date, setDate] = useState('');
  const [opened, setOpened] = useState<string | null>(null);
  const [city, setCity] = useState<number | null>(me.organizerProfile?.cityId ?? null);
  const { data, error, isPending } = useQuery({
    queryKey: ['comedians', 'browse', q, category, city, date],
    queryFn: () =>
      api.comedians({
        q: q.trim() || undefined,
        category: category || undefined,
        city: city ?? undefined,
        date: date || undefined,
      }),
  });

  return (
    <Screen title={t.comedians.title}>
      <TextField label={t.invite.search} value={q} onChange={setQ} />
      <CitySelect
        value={city}
        onChange={setCity}
        anyLabel={t.invite.anyCity}
        onAny={() => setCity(null)}
      />
      <div className="fields">
        <label>
          {t.comedians.category}
          <Select value={category} onChange={(v) => setCategory(v as ComedianCategory | '')}>
            <option value="">{t.invite.anyCategory}</option>
            {comedianCategories.map((c) => (
              <option key={c} value={c}>
                {t.categories[c]}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {t.comedians.date}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <p className="hint">{t.comedians.hint}</p>
      <ErrorText error={error} />
      {data?.length === COMEDIAN_SEARCH_LIMIT && (
        <p className="hint">{t.comedians.limited(COMEDIAN_SEARCH_LIMIT)}</p>
      )}
      {isPending ? (
        <p className="hint">{t.loading}</p>
      ) : data?.length === 0 ? (
        <p className="hint">{t.invite.empty}</p>
      ) : (
        <div className="list">
          {data?.map((c) => (
            <div key={c.id} className="stack">
              <div className="pick">
                {c.photoUrl ? (
                  <img className="avatar" src={c.photoUrl} alt="" />
                ) : (
                  <span className="avatar" />
                )}
                <ComedianSummary c={c} />
                <button
                  className="link-button"
                  onClick={() => setOpened(opened === c.id ? null : c.id)}
                >
                  {opened === c.id ? t.invite.hideCard : t.invite.showCard}
                </button>
              </div>
              {opened === c.id && <ComedianCardView id={c.id} />}
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

export function InviteScreen() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<ComedianCategory | ''>('');
  const [freeOnly, setFreeOnly] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
  // По умолчанию без фильтра: на событие зовут и комиков из других городов.
  const [city, setCity] = useState<number | null>(null);
  const search = useQuery({
    queryKey: ['comedians', q, category, freeOnly, city],
    queryFn: () =>
      api.comedians({
        q: q.trim() || undefined,
        category: category || undefined,
        city: city ?? undefined,
        freeAtEvent: freeOnly ? id : undefined,
      }),
  });
  const invite = useMutation({
    mutationFn: () => api.invite(id!, selected),
    onSuccess: () => {
      haptic('success');
      setSelected([]);
      void queryClient.invalidateQueries({ queryKey: ['lineup', id] });
    },
    onError: () => haptic('error'),
  });
  const toggle = (cid: string) =>
    setSelected((s) => (s.includes(cid) ? s.filter((x) => x !== cid) : [...s, cid]));

  return (
    <Screen title={t.invite.title} back={<BackButton to={`/events/${id}/manage`} />}>
      <TextField label={t.invite.search} value={q} onChange={setQ} />
      <div className="fields">
        <CitySelect
          value={city}
          onChange={setCity}
          anyLabel={t.invite.anyCity}
          onAny={() => setCity(null)}
        />
        <label>
          {t.comedians.category}
          <Select value={category} onChange={(v) => setCategory(v as ComedianCategory | '')}>
            <option value="">{t.invite.anyCategory}</option>
            {comedianCategories.map((c) => (
              <option key={c} value={c}>
                {t.categories[c]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
        <span>{t.invite.freeOnly}</span>
      </label>
      {invite.data && (
        <p className="success">
          {t.invite.result(
            invite.data.invited.length,
            invite.data.skipped.length,
            invite.data.autoAccepted.length,
          )}
        </p>
      )}
      <ErrorText error={invite.error ?? search.error} />
      {search.data?.length === COMEDIAN_SEARCH_LIMIT && (
        <p className="hint">{t.comedians.limited(COMEDIAN_SEARCH_LIMIT)}</p>
      )}
      {search.isPending ? (
        <p className="hint">{t.loading}</p>
      ) : search.data?.length === 0 ? (
        <p className="hint">{t.invite.empty}</p>
      ) : (
        <div className="list">
          {search.data?.map((c) => (
            <div key={c.id} className="stack">
              <label className={`pick${selected.includes(c.id) ? ' selected' : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
                {c.photoUrl ? (
                  <img className="avatar" src={c.photoUrl} alt="" />
                ) : (
                  <span className="avatar" />
                )}
                <ComedianSummary c={c} />
                <button
                  className="link-button"
                  onClick={() => setOpened(opened === c.id ? null : c.id)}
                >
                  {opened === c.id ? t.invite.hideCard : t.invite.showCard}
                </button>
              </label>
              {opened === c.id && <ComedianCardView id={c.id} />}
            </div>
          ))}
        </div>
      )}
      <MainButton
        text={t.invite.submit(selected.length)}
        disabled={selected.length === 0}
        loading={invite.isPending}
        onClick={() => invite.mutate()}
      />
    </Screen>
  );
}
