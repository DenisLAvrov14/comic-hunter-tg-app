import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ru, type AdminPerson, type PendingVenue } from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import { haptic, openTelegramProfile } from '../telegram';
import { BackButton, ErrorText, Screen, TextField } from '../ui';
import { ContactLink, VenueCard } from '../venue-card';

const t = ru.app;
const a = t.admin;
type Tab = 'venues' | 'admins';

/** Админка: проверка новых площадок и список админов. */
export function AdminScreen() {
  const { me } = useMe();
  const [tab, setTab] = useState<Tab>('venues');
  if (!me.isAdmin) return <Navigate to="/more" replace />;
  return (
    <Screen title={a.title} back={<BackButton fallback="/more" />}>
      <div className="tabs">
        {(['venues', 'admins'] as const).map((key) => (
          <button
            key={key}
            className={tab === key ? 'tab active' : 'tab'}
            onClick={() => setTab(key)}
          >
            {a.tabs[key]}
          </button>
        ))}
      </div>
      {tab === 'venues' ? <VenueQueue /> : <Admins />}
    </Screen>
  );
}

/** Как назвать человека: @ник, если есть, иначе имя. */
function handle(p: AdminPerson) {
  return p.telegramUsername ? `@${p.telegramUsername}` : p.name;
}

/** @ник — ссылка на профиль в Telegram, чтобы сразу написать; без ника — просто имя. */
function PersonHandle({ p }: { p: AdminPerson }) {
  const username = p.telegramUsername;
  if (!username) return <span>{p.name}</span>;
  return (
    <button type="button" className="link-button" onClick={() => openTelegramProfile(username)}>
      @{username}
    </button>
  );
}

function VenueQueue() {
  const [done, setDone] = useState<string | null>(null);
  const { data, error, isPending } = useQuery({
    queryKey: ['admin', 'venues'],
    queryFn: api.adminVenues,
  });
  return (
    <>
      {done && <p className="success">{done}</p>}
      {isPending ? (
        <p className="hint">{t.loading}</p>
      ) : error ? (
        <ErrorText error={error} />
      ) : data.length === 0 ? (
        <p className="hint">{a.venuesEmpty}</p>
      ) : (
        data.map((item) => <VenueReview key={item.venue.id} item={item} onDone={setDone} />)
      )}
    </>
  );
}

function VenueReview({ item, onDone }: { item: PendingVenue; onDone: (text: string) => void }) {
  const queryClient = useQueryClient();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const { venue, author } = item;
  const review = useMutation({
    mutationFn: (action: 'approve' | 'reject') =>
      action === 'approve'
        ? api.approveVenue(venue.id)
        : api.rejectVenue(venue.id, reason.trim() || null),
    onSuccess: ({ result }) => {
      haptic('success');
      onDone(
        result === 'approved'
          ? a.approved(venue.name)
          : result === 'deleted'
            ? a.deleted(venue.name)
            : a.hidden(venue.name),
      );
      void queryClient.invalidateQueries({ queryKey: ['admin', 'venues'] });
      void queryClient.invalidateQueries({ queryKey: ['badges'] });
      void queryClient.invalidateQueries({ queryKey: ['venues'] });
    },
    onError: () => {
      haptic('error');
      // Площадку мог проверить другой админ — обновить очередь.
      void queryClient.invalidateQueries({ queryKey: ['admin', 'venues'] });
    },
  });

  return (
    <VenueCard venue={venue} cityName={item.cityName} showStatus={false}>
      <p className="venue-card-meta">
        <span className="hint">{a.addedBy}</span>{' '}
        {author ? <PersonHandle p={author} /> : <span className="hint">{a.authorDeleted}</span>}
        {author?.contact && (
          <>
            <span className="hint"> · </span>
            <ContactLink contact={author.contact} />
          </>
        )}
      </p>
      {rejecting ? (
        <>
          <TextField
            label={a.rejectReason}
            placeholder={a.rejectReasonPlaceholder}
            value={reason}
            onChange={setReason}
            optional
          />
          <div className="action-bar">
            <button
              className="danger"
              disabled={review.isPending}
              onClick={() => review.mutate('reject')}
            >
              {a.rejectConfirm}
            </button>
            <button
              className="secondary"
              disabled={review.isPending}
              onClick={() => setRejecting(false)}
            >
              {a.cancel}
            </button>
          </div>
        </>
      ) : (
        <div className="action-bar">
          <button disabled={review.isPending} onClick={() => review.mutate('approve')}>
            {a.approve}
          </button>
          <button className="danger" disabled={review.isPending} onClick={() => setRejecting(true)}>
            {a.reject}
          </button>
        </div>
      )}
      <ErrorText error={review.error} />
    </VenueCard>
  );
}

function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

function Admins() {
  const { me } = useMe();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim());
  const canManage = me.canManageAdmins;
  const admins = useQuery({ queryKey: ['admin', 'admins'], queryFn: api.admins });
  const found = useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: () => api.searchUsers(query),
    enabled: canManage && query.length >= 2,
  });
  const change = useMutation({
    mutationFn: ({ id, action }: { id: string; action: keyof typeof actions }) =>
      actions[action](id),
    onSuccess: () => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: () => haptic('error'),
  });
  const run = (id: string, action: keyof typeof actions, confirm?: string) => {
    if (!confirm || window.confirm(confirm)) change.mutate({ id, action });
  };

  return (
    <>
      <section className="card">
        <h2>{a.admins}</h2>
        <p className="hint">{a.adminsHint}</p>
        {admins.isPending ? (
          <p className="hint">{t.loading}</p>
        ) : admins.error ? (
          <ErrorText error={admins.error} />
        ) : (
          admins.data.map((p) => {
            const editable = canManage && p.id !== me.id && !p.isOwner;
            return (
              <div key={p.id} className="admin-person">
                <div className="row">
                  <span className="grow">
                    <PersonHandle p={p} />
                  </span>
                  {p.id === me.id && <span className="tag">{a.you}</span>}
                  {p.isOwner ? (
                    <span className="tag tag-accent">{a.owner}</span>
                  ) : (
                    p.canManageAdmins && <span className="tag">{a.manager}</span>
                  )}
                </div>
                {editable && (
                  <div className="action-bar">
                    {p.canManageAdmins ? (
                      <button
                        className="secondary"
                        disabled={change.isPending}
                        onClick={() => run(p.id, 'revokeManage')}
                      >
                        {a.revokeManage}
                      </button>
                    ) : (
                      <button
                        className="secondary"
                        disabled={change.isPending}
                        onClick={() => run(p.id, 'grantManage', a.grantManageConfirm(handle(p)))}
                      >
                        {a.grantManage}
                      </button>
                    )}
                    <button
                      className="danger"
                      disabled={change.isPending}
                      onClick={() => run(p.id, 'revoke', a.revokeConfirm(handle(p)))}
                    >
                      {a.revoke}
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
        <ErrorText error={change.error} />
      </section>

      <section className="card">
        <h2>{a.grantTitle}</h2>
        {!canManage ? (
          <p className="hint">{a.cantManage}</p>
        ) : (
          <>
            <TextField label={a.search} value={q} onChange={setQ} hint={a.searchHint} />
            {query.length >= 2 &&
              (found.isPending ? (
                <p className="hint">{t.loading}</p>
              ) : found.error ? (
                <ErrorText error={found.error} />
              ) : found.data.length === 0 ? (
                <p className="hint">{a.searchEmpty}</p>
              ) : (
                found.data.map((p) => (
                  <div key={p.id} className="admin-person">
                    <div className="row">
                      {/* В поиске имя помогает отличить людей; в списке админов — только ник. */}
                      <span className="grow stack-tight">
                        <PersonHandle p={p} />
                        {p.telegramUsername && <span className="hint">{p.name}</span>}
                      </span>
                      {p.isAdmin ? (
                        <span className="tag">{a.alreadyAdmin}</span>
                      ) : (
                        <button
                          className="secondary"
                          disabled={change.isPending}
                          onClick={() => run(p.id, 'grant')}
                        >
                          {a.grant}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ))}
          </>
        )}
      </section>
    </>
  );
}

const actions = {
  grant: api.grantAdmin,
  revoke: api.revokeAdmin,
  grantManage: api.grantManage,
  revokeManage: api.revokeManage,
};
