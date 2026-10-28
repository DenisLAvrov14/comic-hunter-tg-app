import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ru,
  type EventSummary,
  type ParticipationAction,
  type ScheduleConflict,
} from '@standup/shared';
import { api, ApiRequestError } from './api';
import { formatDateTime, formatRange } from './format';
import { haptic } from './telegram';
import { ErrorText } from './ui';

const t = ru.app;

export function EventCard({ e, to, extra }: { e: EventSummary; to: string; extra?: string }) {
  return (
    <Link className="event-card" to={to}>
      <span className="event-when">{formatDateTime(e.startsAt, e.timezone)}</span>
      <strong>{e.title}</strong>
      <span className="hint">
        {t.formats[e.format]} · {e.venue.name}
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
            c.kind === 'busy' ? c.title || t.conflicts.busy : c.title,
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
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
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
      <div className="row">
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
