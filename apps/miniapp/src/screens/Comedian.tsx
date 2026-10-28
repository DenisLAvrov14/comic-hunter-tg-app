import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  eventFormats,
  ru,
  type EventDetails,
  type EventFormat,
  type InboxItem,
} from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import { ActionError, ConflictPrompt, EventCard, useParticipationAction } from '../events-ui';
import { formatDateTime } from '../format';
import { haptic } from '../telegram';
import { BackButton, ErrorText, MainButton, Screen, TextField } from '../ui';

const t = ru.app;

export function OpenEventsScreen() {
  const { me } = useMe();
  const cityId = me.comedianProfile?.cityId ?? me.organizerProfile?.cityId ?? null;
  const [format, setFormat] = useState<EventFormat | ''>('');
  const [from, setFrom] = useState('');
  const { data, error, isPending } = useQuery({
    queryKey: ['events', 'open', cityId, format, from],
    queryFn: () =>
      api.openEvents({
        city: cityId!,
        format: format || undefined,
        from: from ? new Date(`${from}T00:00`).toISOString() : undefined,
      }),
    enabled: cityId !== null,
  });

  return (
    <Screen title={t.nav.open} back={<BackButton to="/" />}>
      {cityId === null ? (
        <p className="hint">{t.events.needCity}</p>
      ) : (
        <>
          <div className="row">
            <select value={format} onChange={(e) => setFormat(e.target.value as EventFormat | '')}>
              <option value="">{t.events.allFormats}</option>
              {eventFormats.map((f) => (
                <option key={f} value={f}>
                  {t.formats[f]}
                </option>
              ))}
            </select>
            <input
              className="grow"
              type="date"
              aria-label={t.events.fromDate}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
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
                <EventCard key={e.id} e={e} to={`/events/${e.id}`} />
              ))}
            </div>
          )}
        </>
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
    <Screen title={event?.title ?? ''} back={<BackButton to="/" />}>
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
    <Screen title={t.inbox.title} back={<BackButton to="/" />}>
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
  const disabled = action.busy !== null;

  return (
    <section className="card">
      <EventCard e={item.event} to={`/events/${item.event.id}`} />
      {p.isUrgent && <span className="badge">{t.events.urgent}</span>}
      {p.status === 'counter_proposed' ? (
        <p className="hint">
          {t.inbox.waitingOrganizer}: «{p.counterProposal}»
        </p>
      ) : counter === null ? (
        <div className="row wrap">
          <button disabled={disabled} onClick={() => action.run(p.id, 'accept')}>
            {t.inbox.accept}
          </button>
          <button
            className="secondary"
            disabled={disabled}
            onClick={() => action.run(p.id, 'decline')}
          >
            {t.inbox.decline}
          </button>
          <button className="secondary" disabled={disabled} onClick={() => setCounter('')}>
            {t.inbox.counter}
          </button>
        </div>
      ) : (
        <div className="stack">
          <TextField
            label={t.inbox.counter}
            placeholder={t.inbox.counterPlaceholder}
            value={counter}
            onChange={setCounter}
          />
          <div className="row">
            <button
              disabled={disabled || counter.trim() === ''}
              onClick={async () => {
                if (await action.run(p.id, 'counter_propose', { text: counter.trim() }))
                  setCounter(null);
              }}
            >
              {t.inbox.send}
            </button>
            <button className="secondary" onClick={() => setCounter(null)}>
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
