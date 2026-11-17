import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ru } from '@standup/shared';
import { useAuth, useMe } from './auth';
import { ActiveRoleProvider, AppShell, MoreScreen, RoleHome } from './navigation';
import { CalendarScreen } from './screens/Calendar';
import { MapScreen } from './screens/Map';
import { EventScreen, InboxScreen, OpenEventsScreen } from './screens/Comedian';
import { Onboarding } from './screens/Onboarding';
import { HostingScreen, LineupScreen } from './screens/Lineup';
import {
  ComediansScreen,
  EventFormScreen,
  InviteScreen,
  MyEventsScreen,
} from './screens/Organizer';
import { ComedianProfileScreen, OrganizerProfileScreen, RolesScreen } from './screens/Profiles';
import { SettingsScreen } from './screens/Settings';
import { VenuesScreen } from './screens/Venues';
import { AdminScreen } from './screens/Admin';

const t = ru.app;

/**
 * startapp: e_<event> → событие, j_<token> → запись по ссылке, i_<participation> → входящие,
 * a_venues → админка (новая площадка на проверке).
 */
function startTarget(param: string | null): string | null {
  const m = /^([ejia])_([A-Za-z0-9_-]{1,64})$/.exec(param ?? '');
  if (!m) return null;
  if (m[1] === 'e') return `/events/${m[2]}`;
  if (m[1] === 'j') return `/join/${m[2]}`;
  if (m[1] === 'a') return '/admin';
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
    <ActiveRoleProvider>
      <AppShell>
        <Routes>
          <Route path="/welcome" element={<Onboarding />} />
          <Route path="/more" element={<MoreScreen />} />
          <Route path="/profile" element={<ComedianProfileScreen />} />
          <Route path="/organizer" element={<OrganizerProfileScreen />} />
          <Route path="/venues" element={<VenuesScreen />} />
          <Route path="/admin" element={<AdminScreen />} />
          <Route path="/roles" element={<RolesScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/calendar" element={<CalendarScreen />} />
          <Route path="/map" element={<MapScreen />} />
          <Route path="/open" element={<OpenEventsScreen />} />
          <Route path="/inbox" element={<InboxScreen />} />
          <Route path="/join/:token" element={<EventScreen />} />
          <Route path="/my-events" element={<MyEventsScreen />} />
          <Route path="/comedians" element={<ComediansScreen />} />
          <Route path="/events/new" element={<EventFormScreen />} />
          <Route path="/events/:id" element={<EventScreen />} />
          <Route path="/events/:id/edit" element={<EventFormScreen />} />
          <Route path="/events/:id/manage" element={<LineupScreen />} />
          <Route path="/hosting" element={<HostingScreen />} />
          <Route path="/events/:id/invite" element={<InviteScreen />} />
          <Route path="*" element={<RoleHome />} />
        </Routes>
      </AppShell>
    </ActiveRoleProvider>
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
