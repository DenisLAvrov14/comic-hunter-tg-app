import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ru,
  type EventSummary,
  type ParticipationAction,
  type ScheduleConflict,
  type StaffStatus,
} from '@standup/shared';
import { api, ApiRequestError } from './api';
import { formatDateTime, formatRange } from './format';
import { haptic } from './telegram';
import { ErrorText } from './ui';

const t = ru.app;

/** Ответ ведущего на приглашение: «Я веду» и карточка события. */
export function HostAnswer({ eventId, status }: { eventId: string; status: StaffStatus }) {
  const queryClient = useQueryClient();
  const answer = useMutation({
    mutationFn: (value: 'accepted' | 'declined') => api.answerHosting(eventId, value),
    onSuccess: () => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['hosting'] });
      void queryClient.invalidateQueries({ queryKey: ['badges'] });
      void queryClient.invalidateQueries({ queryKey: ['event', eventId] });
    },
    onError: () => haptic('error'),
  });
  return (
    <div className="stack">
      <strong>{status === 'invited' ? t.hosting.invited : t.hosting.accepted}</strong>
      <div className="action-bar">
        {status === 'invited' && (
          <button disabled={answer.isPending} onClick={() => answer.mutate('accepted')}>
            {t.hosting.accept}
          </button>
        )}
        <button
          className="outline danger-text"
          disabled={answer.isPending}
          onClick={() => {
            if (status === 'invited' || window.confirm(t.hosting.declineConfirm))
              answer.mutate('declined');
          }}
        >
          {t.hosting.decline}
        </button>
      </div>
      <ErrorText error={answer.error} />
    </div>
  );
}

export function EventCard({
  e,
  to,
  extra,
  city,
  badge = 0,
}: {
  e: EventSummary;
  to: string;
  extra?: string;
  /** Показывается, когда в списке события из разных городов. */
  city?: string;
  /** Счётчик того, что ждёт ответа (заявки), — как непрочитанные. */
  badge?: number;
}) {
  return (
    <Link className="event-card" to={to}>
      {badge > 0 && <span className="badge-count">{badge}</span>}
      <span className="event-when">{formatDateTime(e.startsAt, e.timezone)}</span>
      <strong>{e.title}</strong>
      <span className="hint">
        {t.formats[e.format]} · {e.venue.name}
        {city ? `, ${city}` : ''}
      </span>
      <span className="hint">
        {e.status !== 'recruiting' ? `${t.eventStatuses[e.status]} · ` : ''}
        {t.events.slots(e.acceptedCount, e.slotsCount)}
        {extra ? ` · ${extra}` : ''}
      </span>
    </Link>
  );
}

export function ConflictList({
  conflicts,
  timezone,
}: {
  conflicts: ScheduleConflict[];
  timezone: string;
}) {
  if (conflicts.length === 0) return null;
  return (
    <div className="warning">
      <strong>{t.conflicts.title}:</strong>
      {conflicts.map((c, i) => (
        <span key={i}>
          {t.conflicts.item(
            c.title ||
              (c.kind === 'busy'
                ? t.conflicts.busy
                : c.kind === 'manual_gig'
                  ? t.calendar.manualGig
                  : ''),
            c.venue,
            formatRange(c.start, c.end, c.timezone || timezone),
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Действие над участием. При пересечении сервер отвечает CONFLICT_SCHEDULE —
 * показываем, с чем пересекается, и даём принять вопреки предупреждению.
 */
export function useParticipationAction(invalidate: unknown[][]) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<{
    id: string;
    action: ParticipationAction;
    conflicts: ScheduleConflict[];
  } | null>(null);

  async function run(
    id: string,
    action: ParticipationAction,
    payload?: { force?: boolean; text?: string },
  ): Promise<boolean> {
    setBusy(id);
    setError(null);
    setConflict(null);
    try {
      await api.participationAction(id, { action, payload });
      haptic('success');
      await Promise.all(
        [...invalidate, ['badges'], ['events', 'mine']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      return true;
    } catch (e) {
      haptic('error');
      if (e instanceof ApiRequestError && e.code === 'CONFLICT_SCHEDULE') {
        const details = e.details as { conflicts?: ScheduleConflict[] } | undefined;
        setConflict({ id, action, conflicts: details?.conflicts ?? [] });
      } else {
        setError(e);
      }
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { run, busy, error, conflict, dismiss: () => setConflict(null) };
}

/** Предупреждение о пересечении у конкретной записи. */
export function ConflictPrompt({
  action,
  forId,
  timezone,
}: {
  action: ReturnType<typeof useParticipationAction>;
  forId: string;
  timezone: string;
}) {
  const c = action.conflict;
  if (!c || c.id !== forId) return null;
  return (
    <div className="stack">
      <ConflictList conflicts={c.conflicts} timezone={timezone} />
      <div className="action-bar">
        <button className="danger" onClick={() => action.run(c.id, c.action, { force: true })}>
          {t.conflicts.acceptAnyway}
        </button>
        <button className="secondary" onClick={action.dismiss}>
          {t.back}
        </button>
      </div>
    </div>
  );
}

export function ActionError({ action }: { action: ReturnType<typeof useParticipationAction> }) {
  return <ErrorText error={action.error} />;
}
