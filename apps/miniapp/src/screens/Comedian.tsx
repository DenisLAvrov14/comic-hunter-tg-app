import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ru,
  selectableEventFormats,
  type EventDetails,
  type EventFormat,
  type InboxItem,
  type MyParticipation,
} from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import {
  ActionError,
  ConflictPrompt,
  EventCard,
  HostAnswer,
  useParticipationAction,
} from '../events-ui';
import { formatDateTime } from '../format';
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

export function OpenEventsScreen() {
  const { me } = useMe();
  const { data: cities = [] } = useCities();
  // Город профиля — только значение по умолчанию: комик ищет и в других городах и странах.
  const [city, setCity] = useState<number | null>(
    me.comedianProfile?.cityId ?? me.organizerProfile?.cityId ?? null,
  );
  const [format, setFormat] = useState<EventFormat | ''>('');
  const [from, setFrom] = useState('');
  const { data, error, isPending } = useQuery({
    queryKey: ['events', 'open', city, format, from],
    queryFn: () =>
      api.openEvents({
        city: city ?? undefined,
        format: format || undefined,
        from: from ? new Date(`${from}T00:00`).toISOString() : undefined,
      }),
  });
  const cityName = (id: number) => (city ? undefined : cities.find((c) => c.id === id)?.name);

  return (
    <Screen title={t.nav.open}>
      <CitySelect
        label={t.events.area}
        value={city}
        onChange={setCity}
        anyLabel={t.events.anyCity}
        onAny={() => setCity(null)}
      />
      <div className="fields">
        <label>
          {t.eventForm.format}
          <Select value={format} onChange={(v) => setFormat(v as EventFormat | '')}>
            <option value="">{t.events.allFormats}</option>
            {selectableEventFormats.map((f) => (
              <option key={f} value={f}>
                {t.formats[f]}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {t.events.fromDate}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
      </div>
      {isPending ? (
        <p className="hint">{t.loading}</p>
      ) : error ? (
        <ErrorText error={error} />
      ) : data.length === 0 ? (
        <p className="hint">{t.events.emptyOpen}</p>
      ) : (
        <div className="list">
          {data.map((e) => (
            <EventCard key={e.id} e={e} to={`/events/${e.id}`} city={cityName(e.venue.cityId)} />
          ))}
        </div>
      )}
    </Screen>
  );
}

/** Карточка события: /events/:id или /join/:token (запись по ссылке). */
export function EventScreen() {
  const { id, token } = useParams();
  const queryKey = ['event', id ?? `link:${token}`];
  const {
    data: event,
    error,
    isPending,
  } = useQuery({
    queryKey,
    queryFn: () => (token ? api.eventByLink(token) : api.event(id!)),
  });

  return (
    <Screen title={event?.title ?? ''} back={<BackButton fallback="/" />}>
      {isPending ? (
        <p className="hint">{t.loading}</p>
      ) : error || !event ? (
        <p className="hint">{t.events.notFound}</p>
      ) : (
        <EventBody event={event} token={token} queryKey={queryKey} />
      )}
    </Screen>
  );
}

function EventBody({
  event,
  token,
  queryKey,
}: {
  event: EventDetails;
  token?: string;
  queryKey: string[];
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const mine = event.viewer.participation;
  const action = useParticipationAction([queryKey, ['inbox']]);
  const apply = useMutation({
    mutationFn: () => api.apply(event.id, { token, message: message.trim() || undefined }),
    onSuccess: () => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: () => haptic('error'),
  });

  return (
    <>
      <section className="card">
        <Row label={t.events.when}>{formatDateTime(event.startsAt, event.timezone)}</Row>
        <Row label={t.events.venue}>
          {event.venue.name}
          <span className="hint"> · {event.venue.address}</span>
        </Row>
        <Row label={t.events.organizer}>
          {event.organizer.displayName}
          {event.organizer.projectName && (
            <span className="hint"> · {event.organizer.projectName}</span>
          )}
        </Row>
        <p className="hint">
          {t.formats[event.format]}
          {event.formatNote ? ` (${event.formatNote})` : ''} ·{' '}
          {t.events.set(event.setMinutes, event.gapMinutes)} ·{' '}
          {t.events.slots(event.acceptedCount, event.slotsCount)}
        </p>
        {event.status !== 'recruiting' && <p className="badge">{t.eventStatuses[event.status]}</p>}
      </section>

      {event.conditions && (
        <section className="card">
          <h2>{t.events.conditions}</h2>
          <p className="pre">{event.conditions}</p>
        </section>
      )}

      {mine && (
        <section className="card">
          <h2>{t.events.myStatus}</h2>
          <p>
            {t.participationStatuses[mine.status]}
            {mine.position ? ` · ${t.events.position(mine.position)}` : ''}
          </p>
          {mine.status === 'accepted' && isSoon(event.startsAt) && (
            <DayConfirmation
              participationId={mine.id}
              answered={mine.dayConfirmation}
              queryKey={queryKey}
            />
          )}
          {['pending', 'invited', 'counter_proposed', 'accepted', 'reserve'].includes(
            mine.status,
          ) && (
            <button
              className="secondary danger-text"
              disabled={action.busy !== null}
              onClick={() => {
                if (window.confirm(t.events.withdrawConfirm)) void action.run(mine.id, 'withdraw');
              }}
            >
              {t.events.withdraw}
            </button>
          )}
          <ActionError action={action} />
        </section>
      )}

      <section className="card">
        <h2>{t.events.lineup}</h2>
        {event.lineup === null ? (
          <p className="hint">{t.events.lineupHidden}</p>
        ) : event.lineup.length === 0 ? (
          <p className="hint">{t.events.lineupEmpty}</p>
        ) : (
          <ol className="lineup">
            {event.lineup.map((l) => (
              <li key={l.position}>{l.stageName}</li>
            ))}
          </ol>
        )}
      </section>

      {event.viewer.isOrganizer && (
        <Link className="button-link" to={`/events/${event.id}/manage`}>
          {t.events.manage}
        </Link>
      )}
      {event.viewer.hostStatus && event.viewer.hostStatus !== 'declined' && (
        <section className="card">
          <HostAnswer eventId={event.id} status={event.viewer.hostStatus} />
        </section>
      )}

      {event.viewer.canApply && (
        <>
          <TextField
            label={t.events.applyMessage}
            optional
            multiline
            value={message}
            onChange={setMessage}
          />
          <ErrorText error={apply.error} />
          <MainButton
            text={token ? t.events.join : t.events.apply}
            loading={apply.isPending}
            onClick={() => apply.mutate()}
          />
        </>
      )}
      {apply.isSuccess && <p className="success">{t.events.applied}</p>}
    </>
  );
}

/** Подтверждение показываем за сутки до начала — как дайджест в день выступления. */
function isSoon(startsAt: string) {
  const ms = new Date(startsAt).getTime() - Date.now();
  return ms > -3 * 3_600_000 && ms < 24 * 3_600_000;
}

/** Отказ — общей кнопкой «Отказаться от участия», здесь только подтверждение. */
function DayConfirmation({
  participationId,
  answered,
  queryKey,
}: {
  participationId: string;
  answered: MyParticipation['dayConfirmation'];
  queryKey: string[];
}) {
  const queryClient = useQueryClient();
  const answer = useMutation({
    mutationFn: () => api.dayConfirmation(participationId, 'confirmed'),
    onSuccess: () => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const result = answer.isSuccess ? 'confirmed' : answered;
  if (result !== 'none') {
    return <p className={result === 'confirmed' ? 'success' : 'hint'}>{t.day[result]}</p>;
  }
  return (
    <div className="stack">
      <strong>{t.day.title}</strong>
      <button disabled={answer.isPending} onClick={() => answer.mutate()}>
        {t.day.confirm}
      </button>
      <ErrorText error={answer.error} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kv">
      <span className="hint">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function InboxScreen() {
  const { data, error, isPending } = useQuery({ queryKey: ['inbox'], queryFn: api.inbox });
  return (
    <Screen title={t.inbox.title}>
      {isPending ? (
        <p className="hint">{t.loading}</p>
      ) : error ? (
        <ErrorText error={error} />
      ) : (
        <>
          <h2>{t.inbox.invitations}</h2>
          {data.invitations.length === 0 ? (
            <p className="hint">{t.inbox.empty}</p>
          ) : (
            data.invitations.map((item) => (
              <InvitationCard key={item.participation.id} item={item} />
            ))
          )}
          <h2>{t.inbox.applications}</h2>
          {data.applications.length === 0 ? (
            <p className="hint">{t.inbox.empty}</p>
          ) : (
            <div className="list">
              {data.applications.map((item) => (
                <EventCard
                  key={item.participation.id}
                  e={item.event}
                  to={`/events/${item.event.id}`}
                  extra={statusLine(item)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Screen>
  );
}

function statusLine(item: InboxItem) {
  const p = item.participation;
  return `${t.participationStatuses[p.status]}${p.position ? `, ${t.events.position(p.position)}` : ''}`;
}

function InvitationCard({ item }: { item: InboxItem }) {
  const p = item.participation;
  const action = useParticipationAction([['inbox']]);
  const [counter, setCounter] = useState<string | null>(null);
  const counterRequired = useRequired([[t.inbox.counter, (counter ?? '').trim() !== '']]);
  const disabled = action.busy !== null;

  return (
    <section className="card invitation">
      <EventCard e={item.event} to={`/events/${item.event.id}`} />
      {p.isUrgent && <span className="badge urgent">{t.inbox.urgentReplacement}</span>}
      {p.status === 'counter_proposed' ? (
        <p className="hint">
          {t.inbox.waitingOrganizer}: «{p.counterProposal}»
        </p>
      ) : counter === null ? (
        <div className="action-bar">
          <button disabled={disabled} onClick={() => action.run(p.id, 'accept')}>
            {t.inbox.accept}
          </button>
          <button
            className="outline danger-text"
            disabled={disabled}
            onClick={() => action.run(p.id, 'decline')}
          >
            {t.inbox.decline}
          </button>
          {p.status === 'invited' && (
            <button className="outline" disabled={disabled} onClick={() => setCounter('')}>
              {t.inbox.counterShort}
            </button>
          )}
        </div>
      ) : (
        <div className="stack">
          <TextField
            label={t.inbox.counter}
            placeholder={t.inbox.counterPlaceholder}
            value={counter}
            invalid={counterRequired.isMissing(t.inbox.counter)}
            onChange={setCounter}
          />
          <MissingText missing={counterRequired.missing} />
          <div className="action-bar">
            <button
              disabled={disabled}
              onClick={async () => {
                if (!counterRequired.check()) return;
                if (await action.run(p.id, 'counter_propose', { text: counter.trim() }))
                  setCounter(null);
              }}
            >
              {t.inbox.send}
            </button>
            <button className="outline" onClick={() => setCounter(null)}>
              {t.back}
            </button>
          </div>
        </div>
      )}
      <ConflictPrompt action={action} forId={p.id} timezone={item.event.timezone} />
      <ActionError action={action} />
    </section>
  );
}
