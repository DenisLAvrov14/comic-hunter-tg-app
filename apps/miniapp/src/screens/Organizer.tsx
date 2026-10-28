import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  comedianCategories,
  eventFormats,
  ru,
  type ComedianCategory,
  type EventDetails,
  type EventFormat,
  type EventInput,
  type LineupItem,
  type ParticipationAction,
} from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import {
  ActionError,
  ConflictList,
  ConflictPrompt,
  EventCard,
  useParticipationAction,
} from '../events-ui';
import { formatTime, toLocalParts, todayLocal } from '../format';
import { haptic } from '../telegram';
import { BackButton, ErrorText, MainButton, Screen, TextField } from '../ui';

const t = ru.app;

export function MyEventsScreen() {
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const { data, error, isPending } = useQuery({
    queryKey: ['events', 'mine', when],
    queryFn: () => api.myEvents(when),
  });
  return (
    <Screen title={t.myEvents.title} back={<BackButton to="/" />}>
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
            <EventCard key={e.id} e={e} to={`/events/${e.id}/manage`} />
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
      gapMinutes: '2',
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
  const cityId = me.organizerProfile?.cityId ?? null;
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

  const ready =
    d.venueId !== '' &&
    d.title.trim() !== '' &&
    d.date !== '' &&
    d.startTime !== '' &&
    Number(d.slotsCount) > 0 &&
    Number(d.setMinutes) > 0;
  const num = (k: 'slotsCount' | 'setMinutes' | 'gapMinutes') => (v: string) =>
    set(k, v.replace(/\D/g, ''));

  return (
    <Screen title={event ? t.eventForm.editTitle : t.eventForm.createTitle} back={<BackButton />}>
      <section className="card">
        <TextField label={t.eventForm.title} value={d.title} onChange={(v) => set('title', v)} />
        <label>
          {t.eventForm.venue}
          <select value={d.venueId} onChange={(e) => set('venueId', e.target.value)}>
            <option value="" disabled>
              {t.eventForm.venuePlaceholder}
            </option>
            {venues.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} — {v.address}
              </option>
            ))}
          </select>
          {venues.data?.length === 0 && (
            <span className="field-hint">
              <Link to="/venues">{t.eventForm.noVenues}</Link>
            </span>
          )}
        </label>
        <div className="row">
          <label className="grow">
            {t.eventForm.format}
            <select value={d.format} onChange={(e) => set('format', e.target.value as EventFormat)}>
              {eventFormats.map((f) => (
                <option key={f} value={f}>
                  {t.formats[f]}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label={t.eventForm.formatNote}
            optional
            value={d.formatNote}
            onChange={(v) => set('formatNote', v)}
          />
        </div>
      </section>

      <section className="card">
        <label>
          {t.eventForm.date}
          <input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <div className="row">
          <label className="grow">
            {t.eventForm.startTime}
            <input
              type="time"
              value={d.startTime}
              onChange={(e) => set('startTime', e.target.value)}
            />
          </label>
          <label className="grow">
            <span>
              {t.eventForm.endTime} <span className="optional">· {t.optional}</span>
            </span>
            <input type="time" value={d.endTime} onChange={(e) => set('endTime', e.target.value)} />
          </label>
        </div>
        {venue && <span className="field-hint">{t.eventForm.timezoneHint(venue.timezone)}</span>}
        <div className="row">
          <TextField
            label={t.eventForm.slots}
            inputMode="numeric"
            value={d.slotsCount}
            onChange={num('slotsCount')}
          />
          <TextField
            label={t.eventForm.setMinutes}
            inputMode="numeric"
            value={d.setMinutes}
            onChange={num('setMinutes')}
          />
          <TextField
            label={t.eventForm.gapMinutes}
            inputMode="numeric"
            value={d.gapMinutes}
            onChange={num('gapMinutes')}
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

      <ErrorText error={save.error} />
      {!event && (
        <button
          className="secondary"
          disabled={!ready || save.isPending}
          onClick={() => save.mutate('draft')}
        >
          {t.eventForm.saveDraft}
        </button>
      )}
      <MainButton
        text={event ? t.eventForm.save : t.eventForm.publish}
        disabled={!ready}
        loading={save.isPending}
        onClick={() => save.mutate(event ? undefined : 'recruiting')}
      />
    </Screen>
  );
}

type Tab = 'accepted' | 'applications' | 'invitations' | 'reserve';

/** Управление событием: набор и состав (drag-and-drop и ведущие — этап 5). */
export function ManageEventScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('accepted');
  const [copied, setCopied] = useState(false);
  const eventQ = useQuery({ queryKey: ['event', id], queryFn: () => api.event(id!) });
  const lineupQ = useQuery({ queryKey: ['lineup', id], queryFn: () => api.lineup(id!) });
  const config = useQuery({
    queryKey: ['authConfig'],
    queryFn: api.authConfig,
    staleTime: Infinity,
  });
  const action = useParticipationAction([
    ['lineup', id],
    ['event', id],
  ]);

  const eventMutation = useMutation({
    mutationFn: (fn: () => Promise<EventDetails>) => fn(),
    onSuccess: (e) => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      if (e.id !== id) navigate(`/events/${e.id}/manage`);
      else queryClient.setQueryData(['event', id], e);
    },
    onError: () => haptic('error'),
  });

  if (eventQ.isPending) return <p className="center hint">{t.loading}</p>;
  const event = eventQ.data;
  if (!event || !event.viewer.isOrganizer)
    return <p className="center hint">{t.events.notFound}</p>;

  const link =
    event.linkToken && config.data?.botUsername && config.data.miniAppShortName
      ? `https://t.me/${config.data.botUsername}/${config.data.miniAppShortName}?startapp=j_${event.linkToken}`
      : null;
  const lineup = lineupQ.data;
  const count = (k: Tab) => lineup?.[k].length ?? 0;
  const active = event.status !== 'cancelled' && event.status !== 'finished';

  return (
    <Screen title={event.title} back={<BackButton to="/my-events" />}>
      <EventCard e={event} to={`/events/${event.id}`} />

      {active && (
        <div className="row wrap">
          <Link className="button-link" to={`/events/${event.id}/invite`}>
            {t.manage.invite}
          </Link>
          <Link className="button-link secondary" to={`/events/${event.id}/edit`}>
            {t.manage.edit}
          </Link>
        </div>
      )}

      <div className="tabs">
        {(['accepted', 'applications', 'invitations', 'reserve'] as const).map((k) => (
          <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
            {t.manage.tabs[k]} {count(k) > 0 && <span className="count">{count(k)}</span>}
          </button>
        ))}
      </div>
      <ActionError action={action} />
      {lineupQ.isPending ? (
        <p className="hint">{t.loading}</p>
      ) : !lineup || lineup[tab].length === 0 ? (
        <p className="hint">{t.manage.empty}</p>
      ) : (
        <div className="list">
          {lineup[tab].map((item) => (
            <LineupRow
              key={item.id}
              item={item}
              timezone={event.timezone}
              action={action}
              disabled={!active || action.busy !== null}
            />
          ))}
        </div>
      )}

      {active && (
        <section className="card">
          <h2>{t.manage.link}</h2>
          {link ? (
            <>
              <code className="link">{link}</code>
              <div className="row wrap">
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(link).then(() => {
                      setCopied(true);
                      haptic('success');
                    });
                  }}
                >
                  {copied ? t.manage.copied : t.manage.copyLink}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    if (window.confirm(t.manage.rotateConfirm)) {
                      setCopied(false);
                      eventMutation.mutate(() => api.rotateLink(event.id));
                    }
                  }}
                >
                  {t.manage.rotateLink}
                </button>
              </div>
            </>
          ) : (
            <p className="hint">{t.manage.linkNotConfigured}</p>
          )}
        </section>
      )}

      <ErrorText error={eventMutation.error} />
      <div className="row wrap">
        <button
          className="secondary"
          onClick={() => eventMutation.mutate(() => api.duplicateEvent(event.id))}
        >
          {t.manage.duplicate}
        </button>
        {active && (
          <button
            className="secondary danger-text"
            onClick={() => {
              if (window.confirm(t.manage.cancelConfirm))
                eventMutation.mutate(() => api.cancelEvent(event.id));
            }}
          >
            {t.manage.cancel}
          </button>
        )}
      </div>
    </Screen>
  );
}

const rowActions: Record<string, Array<[ParticipationAction, string]>> = {
  pending: [
    ['accept', t.manage.accept],
    ['reserve', t.manage.toReserve],
    ['reject', t.manage.reject],
  ],
  counter_proposed: [
    ['accept', t.manage.accept],
    ['reject', t.manage.reject],
  ],
  invited: [['remove', t.manage.remove]],
  accepted: [
    ['reserve', t.manage.toReserve],
    ['remove', t.manage.remove],
  ],
  reserve: [
    ['promote', t.manage.promote],
    ['remove', t.manage.remove],
  ],
};

function LineupRow({
  item,
  timezone,
  action,
  disabled,
}: {
  item: LineupItem;
  timezone: string;
  action: ReturnType<typeof useParticipationAction>;
  disabled: boolean;
}) {
  const c = item.comedian;
  return (
    <div className="lineup-row">
      <div className="row">
        {item.position !== null && <span className="position">{item.position}</span>}
        {c.photoUrl ? (
          <img className="avatar" src={c.photoUrl} alt="" />
        ) : (
          <span className="avatar" />
        )}
        <div className="grow stack-tight">
          <strong>{c.stageName}</strong>
          <span className="hint">
            {t.categories[c.category]} · {c.contact}
            {item.stageStart ? ` · ${t.manage.stageAt(formatTime(item.stageStart, timezone))}` : ''}
            {item.autoAccepted ? ` · ${t.events.autoAccepted}` : ''}
          </span>
        </div>
      </div>
      {item.status !== 'accepted' && item.status !== 'pending' && item.status !== 'reserve' && (
        <span className="hint">{t.participationStatuses[item.status]}</span>
      )}
      {item.message && (
        <p className="quote">
          {t.manage.message}: {item.message}
        </p>
      )}
      {item.counterProposal && item.status === 'counter_proposed' && (
        <p className="quote">
          {t.manage.counterProposal}: {item.counterProposal}
        </p>
      )}
      <ConflictList conflicts={item.conflicts} timezone={timezone} />
      <div className="row wrap">
        {(rowActions[item.status] ?? []).map(([a, label]) => (
          <button
            key={a}
            className={a === 'accept' || a === 'promote' ? '' : 'secondary'}
            disabled={disabled}
            onClick={() => action.run(item.id, a)}
          >
            {label}
          </button>
        ))}
      </div>
      <ConflictPrompt action={action} forId={item.id} timezone={timezone} />
    </div>
  );
}

export function InviteScreen() {
  const { id } = useParams();
  const { me } = useMe();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<ComedianCategory | ''>('');
  const [freeOnly, setFreeOnly] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const city = me.organizerProfile?.cityId;
  const search = useQuery({
    queryKey: ['comedians', q, category, freeOnly, city],
    queryFn: () =>
      api.comedians({
        q: q.trim() || undefined,
        category: category || undefined,
        city,
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
      <div className="row">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as ComedianCategory | '')}
        >
          <option value="">{t.invite.anyCategory}</option>
          {comedianCategories.map((c) => (
            <option key={c} value={c}>
              {t.categories[c]}
            </option>
          ))}
        </select>
        <label className="checkbox grow">
          <input
            type="checkbox"
            checked={freeOnly}
            onChange={(e) => setFreeOnly(e.target.checked)}
          />
          <span>{t.invite.freeOnly}</span>
        </label>
      </div>
      {invite.data && (
        <p className="success">
          {t.invite.result(invite.data.invited.length, invite.data.skipped.length)}
        </p>
      )}
      <ErrorText error={invite.error ?? search.error} />
      {search.isPending ? (
        <p className="hint">{t.loading}</p>
      ) : search.data?.length === 0 ? (
        <p className="hint">{t.invite.empty}</p>
      ) : (
        <div className="list">
          {search.data?.map((c) => (
            <label key={c.id} className={`pick${selected.includes(c.id) ? ' selected' : ''}`}>
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
              <span className="grow stack-tight">
                <strong>{c.stageName}</strong>
                <span className="hint">{t.categories[c.category]}</span>
              </span>
            </label>
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
