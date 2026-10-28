import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ru } from '@standup/shared';
import { useAuth, useMe } from './auth';
import { EventScreen, InboxScreen, OpenEventsScreen } from './screens/Comedian';
import { Onboarding } from './screens/Onboarding';
import { HostingScreen, LineupScreen } from './screens/Lineup';
import { EventFormScreen, InviteScreen, MyEventsScreen } from './screens/Organizer';
import { ComedianProfileScreen, OrganizerProfileScreen, RolesScreen } from './screens/Profiles';
import { VenuesScreen } from './screens/Venues';

const t = ru.app;

function Home() {
  const { me } = useMe();
  const name = me.comedianProfile?.stageName ?? me.organizerProfile?.displayName ?? me.firstName;
  return (
    <div className="screen">
      <h1>{t.hello(name)}</h1>
      <p className="hint">{t.homeNote}</p>
      <nav className="list">
        {me.roles.includes('comedian') && (
          <>
            <Link to="/open">{t.nav.open}</Link>
            <Link to="/inbox">{t.nav.inbox}</Link>
            <Link to="/profile">{t.menu.comedianProfile}</Link>
          </>
        )}
        {me.roles.includes('organizer') && (
          <>
            <Link to="/my-events">{t.nav.myEvents}</Link>
            <Link to="/organizer">{t.menu.organizerProfile}</Link>
            <Link to="/venues">{t.menu.venues}</Link>
          </>
        )}
        {me.roles.includes('host') && <Link to="/hosting">{t.nav.hosting}</Link>}
        <Link to="/roles">{t.menu.roles}</Link>
      </nav>
    </div>
  );
}

/** startapp: e_<event> → событие, j_<token> → запись по ссылке, i_<participation> → входящие. */
function startTarget(param: string | null): string | null {
  const m = /^([eji])_([A-Za-z0-9_-]{1,64})$/.exec(param ?? '');
  if (!m) return null;
  if (m[1] === 'e') return `/events/${m[2]}`;
  if (m[1] === 'j') return `/join/${m[2]}`;
  return '/inbox';
}

function AuthenticatedRoutes() {
  const { me } = useMe();
  const { state } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [pendingStart, setPendingStart] = useState(() =>
    startTarget(state.status === 'authenticated' ? state.startParam : null),
  );

  // Переход по startapp — сразу или после онбординга.
  useEffect(() => {
    if (pendingStart && me.onboarded && pathname !== '/welcome') {
      navigate(pendingStart, { replace: true });
      setPendingStart(null);
    }
  }, [pendingStart, me.onboarded, pathname, navigate]);

  // Пока онбординг не пройден, все экраны ведут в него. После — /welcome доступен
  // до конца (там ещё шаг с уведомлениями).
  if (!me.onboarded && pathname !== '/welcome') return <Navigate to="/welcome" replace />;
  return (
    <Routes>
      <Route path="/welcome" element={<Onboarding />} />
      <Route path="/profile" element={<ComedianProfileScreen />} />
      <Route path="/organizer" element={<OrganizerProfileScreen />} />
      <Route path="/venues" element={<VenuesScreen />} />
      <Route path="/roles" element={<RolesScreen />} />
      <Route path="/open" element={<OpenEventsScreen />} />
      <Route path="/inbox" element={<InboxScreen />} />
      <Route path="/join/:token" element={<EventScreen />} />
      <Route path="/my-events" element={<MyEventsScreen />} />
      <Route path="/events/new" element={<EventFormScreen />} />
      <Route path="/events/:id" element={<EventScreen />} />
      <Route path="/events/:id/edit" element={<EventFormScreen />} />
      <Route path="/events/:id/manage" element={<LineupScreen />} />
      <Route path="/hosting" element={<HostingScreen />} />
      <Route path="/events/:id/invite" element={<InviteScreen />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

function DevLogin() {
  const { devLogin } = useAuth();
  const [telegramId, setTelegramId] = useState('1000001');
  const [firstName, setFirstName] = useState('Dev');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await devLogin(Number(telegramId), firstName);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit}>
      <h1>{t.devLogin.title}</h1>
      <p className="hint">{t.devLogin.hint}</p>
      <label>
        {t.devLogin.telegramId}
        <input
          inputMode="numeric"
          value={telegramId}
          onChange={(e) => setTelegramId(e.target.value)}
        />
      </label>
      <label>
        {t.devLogin.firstName}
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="submit">{t.devLogin.submit}</button>
    </form>
  );
}

export function App() {
  const { state, retry } = useAuth();

  switch (state.status) {
    case 'loading':
      return <p className="center hint">{t.loading}</p>;
    case 'dev-login':
      return <DevLogin />;
    case 'not-in-telegram':
      return <p className="center hint">{t.notInTelegram}</p>;
    case 'error':
      return (
        <div className="card">
          <h1>{t.authError}</h1>
          <p className="error">{state.message}</p>
          <button onClick={retry}>{t.retry}</button>
        </div>
      );
    case 'authenticated':
      return <AuthenticatedRoutes />;
  }
}
