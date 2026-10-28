import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  hostPermissionKeys,
  ru,
  type EventDetails,
  type Lineup,
  type LineupItem,
  type ParticipationAction,
  type StaffMember,
} from '@standup/shared';
import { api, ApiRequestError } from '../api';
import {
  ActionError,
  ConflictList,
  ConflictPrompt,
  EventCard,
  useParticipationAction,
} from '../events-ui';
import { formatTime } from '../format';
import { haptic, setVerticalSwipes } from '../telegram';
import { BackButton, ErrorText, Screen, TextField } from '../ui';

const t = ru.app;
const l = t.lineup;

type Tab = 'accepted' | 'applications' | 'invitations' | 'reserve';

interface Rights {
  organizer: boolean;
  reorder: boolean;
  attendance: boolean;
  callReserve: boolean;
  notify: boolean;
}

function rightsOf(e: EventDetails): Rights {
  const p = e.viewer.staffPermissions ?? {};
  const o = e.viewer.isOrganizer;
  return {
    organizer: o,
    reorder: o || !!p.can_reorder,
    attendance: o || !!p.can_mark_attendance,
    callReserve: o || !!p.can_call_reserve,
    notify: o || !!p.can_notify_lineup,
  };
}

/** Экран состава: организатор — всё, ведущий — в пределах своих прав (SPEC §5, §6.3). */
export function LineupScreen() {
  const { id } = useParams();
  const eventQ = useQuery({ queryKey: ['event', id], queryFn: () => api.event(id!) });
  // Второй редактор видит изменения: опрос каждые 5 секунд.
  const lineupQ = useQuery({
    queryKey: ['lineup', id],
    queryFn: () => api.lineup(id!),
    refetchInterval: 5000,
  });

  useEffect(() => {
    setVerticalSwipes(false);
    return () => setVerticalSwipes(true);
  }, []);

  if (eventQ.isPending) return <p className="center hint">{t.loading}</p>;
  const event = eventQ.data;
  if (!event || (!event.viewer.isOrganizer && !event.viewer.staffPermissions)) {
    return <p className="center hint">{t.events.notFound}</p>;
  }
  return (
    <Screen
      title={event.title}
      back={<BackButton to={event.viewer.isOrganizer ? '/my-events' : '/hosting'} />}
    >
      <LineupBody event={event} lineup={lineupQ.data} rights={rightsOf(event)} />
    </Screen>
  );
}

function LineupBody({
  event,
  lineup,
  rights,
}: {
  event: EventDetails;
  lineup: Lineup | undefined;
  rights: Rights;
}) {
  const [tab, setTab] = useState<Tab>('accepted');
  const [replacing, setReplacing] = useState<LineupItem | null>(null);
  const action = useParticipationAction([
    ['lineup', event.id],
    ['event', event.id],
  ]);
  const active = event.status !== 'cancelled' && event.status !== 'finished';
  const tabs: Tab[] = rights.organizer
    ? ['accepted', 'applications', 'invitations', 'reserve']
    : ['accepted', 'reserve'];

  return (
    <>
      <EventCard e={event} to={`/events/${event.id}`} />
      {rights.organizer && active && (
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
        {tabs.map((k) => (
          <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
            {t.manage.tabs[k]}
            {(lineup?.[k].length ?? 0) > 0 && <span className="count">{lineup![k].length}</span>}
          </button>
        ))}
      </div>
      <ActionError action={action} />

      {!lineup ? (
        <p className="hint">{t.loading}</p>
      ) : replacing ? (
        <Replacement
          event={event}
          lineup={lineup}
          dropped={replacing}
          onDone={() => setReplacing(null)}
        />
      ) : tab === 'accepted' ? (
        <AcceptedList
          event={event}
          lineup={lineup}
          rights={rights}
          action={action}
          active={active}
          onReplace={setReplacing}
        />
      ) : tab === 'applications' ? (
        <Applications event={event} items={lineup.applications} action={action} active={active} />
      ) : (
        <SimpleList
          event={event}
          items={lineup[tab]}
          action={action}
          disabled={!active || !rights.organizer}
        />
      )}

      <Tools event={event} lineup={lineup} rights={rights} active={active} />
    </>
  );
}

// --- Состав с перетаскиванием ---

function AcceptedList({
  event,
  lineup,
  rights,
  action,
  active,
  onReplace,
}: {
  event: EventDetails;
  lineup: Lineup;
  rights: Rights;
  action: ReturnType<typeof useParticipationAction>;
  active: boolean;
  onReplace: (item: LineupItem) => void;
}) {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<LineupItem[]>(lineup.accepted);
  const [notice, setNotice] = useState<string | null>(null);
  // Пока ничего не тащим, показываем данные с сервера (в том числе после опроса).
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setOrder(lineup.accepted);
  }, [lineup.accepted, dragging]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.reorder(event.id, ids, lineup.version),
    onSuccess: (fresh) => {
      haptic('success');
      setNotice(null);
      queryClient.setQueryData(['lineup', event.id], fresh);
    },
    onError: (e) => {
      haptic('error');
      if (e instanceof ApiRequestError && e.code === 'VERSION_MISMATCH')
        setNotice(l.versionConflict);
      void queryClient.invalidateQueries({ queryKey: ['lineup', event.id] });
    },
    onSettled: () => setDragging(false),
  });

  function onDragEnd(e: DragEndEvent) {
    const from = order.findIndex((x) => x.id === e.active.id);
    const to = order.findIndex((x) => x.id === e.over?.id);
    if (from < 0 || to < 0 || from === to) {
      setDragging(false);
      return;
    }
    const next = arrayMove(order, from, to);
    setOrder(next);
    reorder.mutate(next.map((x) => x.id));
  }

  if (order.length === 0) return <p className="hint">{t.manage.empty}</p>;
  const canDrag = rights.reorder && active;
  return (
    <>
      {canDrag && order.length > 1 && <p className="hint">{l.dragHint}</p>}
      {notice && <p className="warning">{notice}</p>}
      <ErrorText
        error={
          reorder.error instanceof ApiRequestError && reorder.error.code === 'VERSION_MISMATCH'
            ? null
            : reorder.error
        }
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDragging(true)}
        onDragCancel={() => setDragging(false)}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={order.map((x) => x.id)} strategy={verticalListSortingStrategy}>
          <div className="list">
            {order.map((item, i) => (
              <SortableRow key={item.id} id={item.id} disabled={!canDrag}>
                <ItemHead item={{ ...item, position: i + 1 }} timezone={event.timezone} />
                <DayStatus item={item} />
                <div className="row wrap">
                  {rights.attendance && active && <Attendance item={item} eventId={event.id} />}
                  {rights.callReserve && active && lineup.reserve.length > 0 && (
                    <button className="secondary" onClick={() => onReplace(item)}>
                      {l.replace}
                    </button>
                  )}
                  {rights.organizer &&
                    active &&
                    (
                      [
                        ['reserve', t.manage.toReserve],
                        ['remove', t.manage.remove],
                      ] as const
                    ).map(([a, label]) => (
                      <button
                        key={a}
                        className="secondary"
                        disabled={action.busy !== null}
                        onClick={() => action.run(item.id, a)}
                      >
                        {label}
                      </button>
                    ))}
                </div>
              </SortableRow>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </>
  );
}

function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={`lineup-row${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="row">
        {!disabled && (
          <span className="handle" aria-label={l.dragHint} {...attributes} {...listeners}>
            ⋮⋮
          </span>
        )}
        <div className="grow stack">{children}</div>
      </div>
    </div>
  );
}

function ItemHead({ item, timezone }: { item: LineupItem; timezone: string }) {
  const c = item.comedian;
  return (
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
          {item.isUrgent ? ` · ${l.calling}` : ''}
        </span>
      </div>
    </div>
  );
}

function DayStatus({ item }: { item: LineupItem }) {
  if (item.dayConfirmation === 'none') return null;
  return (
    <span className={item.dayConfirmation === 'confirmed' ? 'success' : 'danger-text'}>
      {item.dayConfirmation === 'confirmed' ? `✓ ${l.confirmed}` : `✕ ${l.declinedDay}`}
    </span>
  );
}

function Attendance({ item, eventId }: { item: LineupItem; eventId: string }) {
  const queryClient = useQueryClient();
  const mark = useMutation({
    mutationFn: (value: 'unknown' | 'present' | 'absent') => api.attendance(item.id, value),
    onSuccess: () => {
      haptic();
      void queryClient.invalidateQueries({ queryKey: ['lineup', eventId] });
    },
  });
  return (
    <>
      {(['present', 'absent'] as const).map((v) => (
        <button
          key={v}
          className={item.attendance === v ? '' : 'secondary'}
          disabled={mark.isPending}
          onClick={() => mark.mutate(item.attendance === v ? 'unknown' : v)}
        >
          {l[v]}
        </button>
      ))}
    </>
  );
}

// --- Заявки с массовыми действиями ---

function Applications({
  event,
  items,
  action,
  active,
}: {
  event: EventDetails;
  items: LineupItem[];
  action: ReturnType<typeof useParticipationAction>;
  active: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    setSelected((s) => s.filter((id) => items.some((i) => i.id === id)));
  }, [items]);

  // Выбранные обрабатываются по очереди; на пересечении — остановка с предупреждением у записи.
  async function bulk(a: ParticipationAction) {
    setRunning(true);
    for (const id of selected) {
      if (!(await action.run(id, a))) break;
    }
    setRunning(false);
  }

  if (items.length === 0) return <p className="hint">{t.manage.empty}</p>;
  const disabled = !active || running || action.busy !== null;
  return (
    <>
      {selected.length > 0 && (
        <div className="bulk">
          <span className="hint">{l.selected(selected.length)}</span>
          <div className="row wrap">
            <button disabled={disabled} onClick={() => bulk('accept')}>
              {l.acceptSelected}
            </button>
            <button className="secondary" disabled={disabled} onClick={() => bulk('reserve')}>
              {l.reserveSelected}
            </button>
            <button className="secondary" disabled={disabled} onClick={() => bulk('reject')}>
              {l.rejectSelected}
            </button>
          </div>
        </div>
      )}
      <div className="list">
        {items.map((item) => (
          <div key={item.id} className="lineup-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={(e) =>
                  setSelected((s) =>
                    e.target.checked ? [...s, item.id] : s.filter((x) => x !== item.id),
                  )
                }
              />
              <ItemHead item={item} timezone={event.timezone} />
            </label>
            <ItemDetails item={item} timezone={event.timezone} />
            <RowActions item={item} action={action} disabled={disabled} />
            <ConflictPrompt action={action} forId={item.id} timezone={event.timezone} />
          </div>
        ))}
      </div>
    </>
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
  reserve: [
    ['promote', t.manage.promote],
    ['remove', t.manage.remove],
  ],
};

function RowActions({
  item,
  action,
  disabled,
}: {
  item: LineupItem;
  action: ReturnType<typeof useParticipationAction>;
  disabled: boolean;
}) {
  const actions = rowActions[item.status] ?? [];
  if (actions.length === 0) return null;
  return (
    <div className="row wrap">
      {actions.map(([a, label]) => (
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
  );
}

function ItemDetails({ item, timezone }: { item: LineupItem; timezone: string }) {
  return (
    <>
      {item.status === 'counter_proposed' && (
        <span className="hint">{t.participationStatuses.counter_proposed}</span>
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
    </>
  );
}

function SimpleList({
  event,
  items,
  action,
  disabled,
}: {
  event: EventDetails;
  items: LineupItem[];
  action: ReturnType<typeof useParticipationAction>;
  disabled: boolean;
}) {
  if (items.length === 0) return <p className="hint">{t.manage.empty}</p>;
  return (
    <div className="list">
      {items.map((item) => (
        <div key={item.id} className="lineup-row">
          <ItemHead item={item} timezone={event.timezone} />
          <ItemDetails item={item} timezone={event.timezone} />
          {!disabled && <RowActions item={item} action={action} disabled={action.busy !== null} />}
          <ConflictPrompt action={action} forId={item.id} timezone={event.timezone} />
        </div>
      ))}
    </div>
  );
}

// --- Замена из резерва ---

function Replacement({
  event,
  lineup,
  dropped,
  onDone,
}: {
  event: EventDetails;
  lineup: Lineup;
  dropped: LineupItem;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  // Без пересечений — наверху.
  const reserves = useMemo(
    () => [...lineup.reserve].sort((a, b) => a.conflicts.length - b.conflicts.length),
    [lineup.reserve],
  );
  const [selected, setSelected] = useState<string[]>(() =>
    reserves.filter((r) => r.conflicts.length === 0).map((r) => r.id),
  );
  const call = useMutation({
    mutationFn: () => api.replacement(event.id, dropped.id, selected),
    onSuccess: (fresh) => {
      haptic('success');
      queryClient.setQueryData(['lineup', event.id], fresh);
      onDone();
    },
    onError: () => haptic('error'),
  });

  return (
    <section className="card">
      <h2>{l.replaceTitle(dropped.comedian.stageName)}</h2>
      <p className="hint">{l.replaceHint}</p>
      {reserves.length === 0 ? (
        <p className="hint">{l.noReserve}</p>
      ) : (
        <div className="list">
          {reserves.map((r) => (
            <label key={r.id} className={`pick${selected.includes(r.id) ? ' selected' : ''}`}>
              <input
                type="checkbox"
                checked={selected.includes(r.id)}
                onChange={() =>
                  setSelected((s) =>
                    s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id],
                  )
                }
              />
              <span className="grow stack">
                <ItemHead item={r} timezone={event.timezone} />
                <ConflictList conflicts={r.conflicts} timezone={event.timezone} />
              </span>
            </label>
          ))}
        </div>
      )}
      <ErrorText error={call.error} />
      <div className="row">
        <button disabled={selected.length === 0 || call.isPending} onClick={() => call.mutate()}>
          {l.call(selected.length)}
        </button>
        <button className="secondary" onClick={onDone}>
          {t.back}
        </button>
      </div>
    </section>
  );
}

// --- Афиша, рассылка, ведущие, ссылка ---

function Tools({
  event,
  lineup,
  rights,
  active,
}: {
  event: EventDetails;
  lineup: Lineup | undefined;
  rights: Rights;
  active: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState<'poster' | 'link' | null>(null);
  const [text, setText] = useState('');
  const config = useQuery({
    queryKey: ['authConfig'],
    queryFn: api.authConfig,
    staleTime: Infinity,
  });

  const copy = async (what: 'poster' | 'link', value: string) => {
    await navigator.clipboard?.writeText(value);
    setCopied(what);
    haptic('success');
  };
  const poster = useMutation({
    mutationFn: () => api.posterText(event.id),
    onSuccess: (r) => copy('poster', r.text),
  });
  const broadcast = useMutation({
    mutationFn: () => api.broadcast(event.id, text.trim()),
    onSuccess: () => {
      setText('');
      haptic('success');
    },
  });
  const eventMutation = useMutation({
    mutationFn: (fn: () => Promise<EventDetails>) => fn(),
    onSuccess: (e) => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['events'] });
      if (e.id !== event.id) navigate(`/events/${e.id}/manage`);
      else queryClient.setQueryData(['event', event.id], e);
    },
  });

  const link =
    event.linkToken && config.data?.botUsername && config.data.miniAppShortName
      ? `https://t.me/${config.data.botUsername}/${config.data.miniAppShortName}?startapp=j_${event.linkToken}`
      : null;

  return (
    <>
      <button className="secondary" disabled={poster.isPending} onClick={() => poster.mutate()}>
        {copied === 'poster' ? t.manage.copied : l.poster}
      </button>
      <ErrorText error={poster.error} />

      {rights.notify && active && (
        <section className="card">
          <h2>{l.broadcast}</h2>
          <TextField
            label={l.broadcast}
            placeholder={l.broadcastPlaceholder}
            multiline
            value={text}
            onChange={setText}
          />
          <button
            disabled={text.trim() === '' || broadcast.isPending}
            onClick={() => broadcast.mutate()}
          >
            {l.broadcastSend}
          </button>
          {broadcast.data && (
            <p className="success">
              {l.broadcastResult(broadcast.data.queued, broadcast.data.skipped)}
            </p>
          )}
          <ErrorText error={broadcast.error} />
        </section>
      )}

      {rights.organizer && lineup && <Hosts event={event} staff={lineup.staff} />}

      {rights.organizer && active && event.status !== 'draft' && <Posts event={event} />}

      {rights.organizer && active && (
        <section className="card">
          <h2>{t.manage.link}</h2>
          {link ? (
            <>
              <code className="link">{link}</code>
              <div className="row wrap">
                <button onClick={() => copy('link', link)}>
                  {copied === 'link' ? t.manage.copied : t.manage.copyLink}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    if (window.confirm(t.manage.rotateConfirm)) {
                      setCopied(null);
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

      {rights.organizer && (
        <>
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
                  if (window.confirm(t.manage.cancelConfirm)) {
                    eventMutation.mutate(() => api.cancelEvent(event.id));
                  }
                }}
              >
                {t.manage.cancel}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Hosts({ event, staff }: { event: EventDetails; staff: StaffMember[] }) {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const candidates = useQuery({
    queryKey: ['hosts', q],
    queryFn: () => api.hosts(q.trim()),
    enabled: adding,
  });
  const update = useMutation({
    mutationFn: (fn: () => Promise<Lineup>) => fn(),
    onSuccess: (fresh) => {
      haptic('success');
      queryClient.setQueryData(['lineup', event.id], fresh);
    },
  });
  const perms = (m: Pick<StaffMember, 'permissions'>) =>
    Object.fromEntries(hostPermissionKeys.map((k) => [k, !!m.permissions[k]])) as Record<
      (typeof hostPermissionKeys)[number],
      boolean
    >;

  return (
    <section className="card">
      <h2>{l.hosts}</h2>
      {staff.map((m) => (
        <div key={m.userId} className="stack">
          <div className="row">
            <strong className="grow">
              {m.name}
              {m.username && <span className="hint"> @{m.username}</span>}
            </strong>
            <button
              className="secondary"
              onClick={() => update.mutate(() => api.deleteStaff(event.id, m.userId))}
            >
              {l.removeHost}
            </button>
          </div>
          {hostPermissionKeys.map((k) => (
            <label key={k} className="checkbox">
              <input
                type="checkbox"
                checked={!!m.permissions[k]}
                onChange={(e) =>
                  update.mutate(() =>
                    api.putStaff(event.id, m.userId, { ...perms(m), [k]: e.target.checked }),
                  )
                }
              />
              <span>{l.permissions[k]}</span>
            </label>
          ))}
        </div>
      ))}
      {adding ? (
        <>
          <TextField label={l.hostSearch} value={q} onChange={setQ} />
          {candidates.data?.length === 0 && <p className="hint">{l.noHosts}</p>}
          {candidates.data
            ?.filter((h) => !staff.some((s) => s.userId === h.userId))
            .map((h) => (
              <button
                key={h.userId}
                className="secondary"
                onClick={() => {
                  setAdding(false);
                  update.mutate(() =>
                    api.putStaff(event.id, h.userId, {
                      can_reorder: false,
                      can_mark_attendance: true,
                      can_call_reserve: false,
                      can_notify_lineup: false,
                    }),
                  );
                }}
              >
                {h.name}
                {h.username ? ` @${h.username}` : ''}
              </button>
            ))}
        </>
      ) : (
        <button className="secondary" onClick={() => setAdding(true)}>
          + {l.addHost}
        </button>
      )}
      <ErrorText error={update.error} />
    </section>
  );
}

/** Анонс в группы и каналы, куда организатор добавил бота (SPEC §7.4). */
function Posts({ event }: { event: EventDetails }) {
  const p = t.posts;
  const queryClient = useQueryClient();
  const chats = useQuery({ queryKey: ['myChats'], queryFn: api.myChats });
  const posts = useQuery({
    queryKey: ['posts', event.id],
    queryFn: () => api.eventPosts(event.id),
  });
  const config = useQuery({
    queryKey: ['authConfig'],
    queryFn: api.authConfig,
    staleTime: Infinity,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const publish = useMutation({
    mutationFn: () => api.publishPosts(event.id, selected),
    onSuccess: (r) => {
      haptic(r.failed.length ? 'error' : 'success');
      setSelected([]);
      queryClient.setQueryData(['posts', event.id], r.posts);
    },
  });

  return (
    <section className="card">
      <h2>{p.title}</h2>
      <p className="hint">{p.hint(config.data?.botUsername ?? '')}</p>
      {posts.data && posts.data.length > 0 && (
        <p className="success">
          {p.published}: {posts.data.map((x) => x.title).join(', ')}
        </p>
      )}
      {chats.data?.length === 0 && <p className="hint">{p.empty}</p>}
      {chats.data?.map((c) => (
        <label key={c.id} className="checkbox">
          <input
            type="checkbox"
            disabled={!c.botCanPost}
            checked={selected.includes(c.id)}
            onChange={() =>
              setSelected((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))
            }
          />
          <span>
            {c.title}
            {!c.botCanPost && <span className="hint"> · {p.noRights}</span>}
          </span>
        </label>
      ))}
      {chats.data && chats.data.length > 0 && (
        <button
          disabled={selected.length === 0 || publish.isPending}
          onClick={() => publish.mutate()}
        >
          {p.publish(selected.length)}
        </button>
      )}
      {publish.data && publish.data.failed.length > 0 && (
        <p className="error">{p.failed(publish.data.failed.length)}</p>
      )}
      <ErrorText error={publish.error ?? chats.error} />
    </section>
  );
}

/** «События, где я ведущий». */
export function HostingScreen() {
  const { data, error, isPending } = useQuery({ queryKey: ['hosting'], queryFn: api.hosting });
  return (
    <Screen title={t.hosting.title} back={<BackButton to="/" />}>
      {isPending ? (
        <p className="hint">{t.loading}</p>
      ) : error ? (
        <ErrorText error={error} />
      ) : data.length === 0 ? (
        <p className="hint">{t.hosting.empty}</p>
      ) : (
        <div className="list">
          {data.map((e) => (
            <EventCard key={e.id} e={e} to={`/events/${e.id}/manage`} />
          ))}
        </div>
      )}
    </Screen>
  );
}
