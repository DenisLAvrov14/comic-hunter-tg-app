import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ru, userRoles, type Badges, type UserRole } from '@standup/shared';
import { api, setToken } from './api';
import { useMe } from './auth';
import { haptic } from './telegram';
import { ErrorText, Screen } from './ui';

const t = ru.app;
const ROLE_KEY = 'standup.activeRole';

// Контуры значков, рисуются по одному шаблону в Icon.
const ICONS = {
  calendar:
    'M6 5h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM3 10h18M8 3v4M16 3v4',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  inbox: 'M4 13h5l1.5 3h3l1.500-3h5M6 5h12l2 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5z',
  person: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21a8 8 0 0 1 16 0',
  people:
    'M9 5a3.500 3.500 0 1 1 0 7 3.500 3.500 0 0 1 0-7zM2.500 20a6.500 6.500 0 0 1 13 0M16 5.300a3.500 3.500 0 0 1 0 6.400M18 14.500a6.500 6.500 0 0 1 3.500 5.500',
  mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4',
  pin: 'M12 21s7-6.200 7-12a7 7 0 0 0-14 0c0 5.800 7 12 7 12zM12 6.500a2.500 2.500 0 1 1 0 5 2.500 2.500 0 0 1 0-5z',
  more: 'M5 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM12 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM19 11a1 1 0 1 1 0 2 1 1 0 0 1 0-2z',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
} as const;

/** Какой счётчик из /me/badges показывать на вкладке. */
type BadgeKey = keyof Badges;

interface Tab {
  path: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: BadgeKey;
}

// Профиль — в «Ещё», его место заняла «Карта».
const TABS: Record<UserRole, Tab[]> = {
  comedian: [
    { path: '/calendar', label: t.tabs.calendar, icon: 'calendar' },
    { path: '/open', label: t.tabs.open, icon: 'search' },
    { path: '/inbox', label: t.tabs.inbox, icon: 'inbox', badge: 'inbox' },
    { path: '/map', label: t.tabs.map, icon: 'map' },
  ],
  organizer: [
    { path: '/my-events', label: t.tabs.events, icon: 'mic', badge: 'events' },
    { path: '/comedians', label: t.tabs.comedians, icon: 'people' },
    { path: '/venues', label: t.tabs.venues, icon: 'pin' },
    { path: '/map', label: t.tabs.map, icon: 'map' },
  ],
  host: [{ path: '/hosting', label: t.tabs.hosting, icon: 'mic', badge: 'hosting' }],
};

/** Счётчик роли в переключателе: что ждёт ответа на её вкладках. */
const roleBadge = (role: UserRole, b: Badges | undefined) =>
  b ? TABS[role].reduce((n, tab) => n + (tab.badge ? b[tab.badge] : 0), 0) : 0;

/** Счётчики «как непрочитанные»: опрос раз в 30 секунд и при возврате в приложение. */
export function useBadges() {
  return useQuery({
    queryKey: ['badges'],
    queryFn: api.badges,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

function Count({ n, className }: { n: number; className: string }) {
  if (n <= 0) return null;
  return <span className={className}>{n > 99 ? '99+' : n}</span>;
}
const MORE_TAB: Tab = { path: '/more', label: t.tabs.more, icon: 'more' };

const tabsOf = (role: UserRole | null): Tab[] => [...(role ? TABS[role] : []), MORE_TAB];

function readStoredRole(): string | null {
  try {
    return localStorage.getItem(ROLE_KEY);
  } catch {
    return null;
  }
}

function storeRole(role: UserRole) {
  try {
    localStorage.setItem(ROLE_KEY, role);
  } catch {
    // Без хранилища выбор просто не переживёт перезапуск.
  }
}

const ActiveRoleContext = createContext<{
  active: UserRole | null;
  setActive: (role: UserRole) => void;
} | null>(null);

export function useActiveRole() {
  const value = useContext(ActiveRoleContext);
  if (!value) throw new Error('useActiveRole вне ActiveRoleProvider');
  return value;
}

/** Роль, чьё меню сейчас открыто. Выбор хранится на устройстве. */
export function ActiveRoleProvider({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const [stored, setStored] = useState(readStoredRole);
  const value = useMemo(
    () => ({
      active:
        me.roles.find((r) => r === stored) ?? userRoles.find((r) => me.roles.includes(r)) ?? null,
      setActive: (role: UserRole) => {
        storeRole(role);
        setStored(role);
      },
    }),
    [me.roles, stored],
  );
  return <ActiveRoleContext.Provider value={value}>{children}</ActiveRoleContext.Provider>;
}

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

function RoleSwitch() {
  const { me } = useMe();
  const { active, setActive } = useActiveRole();
  const navigate = useNavigate();
  const badges = useBadges();
  return (
    <div className="tabs role-switch" aria-label={t.rolesScreen.title}>
      {userRoles
        .filter((role) => me.roles.includes(role))
        .map((role) => (
          <button
            key={role}
            className={role === active ? 'tab active' : 'tab'}
            aria-pressed={role === active}
            onClick={() => {
              if (role === active) return;
              haptic();
              setActive(role);
              navigate(tabsOf(role)[0]!.path, { replace: true });
            }}
          >
            {t.roles[role]}
            {role !== active && <Count n={roleBadge(role, badges.data)} className="role-badge" />}
          </button>
        ))}
    </div>
  );
}

function TabBar({ tabs }: { tabs: Tab[] }) {
  const { pathname } = useLocation();
  const badges = useBadges();
  return (
    <nav className="tabbar">
      <div className="tabbar-inner">
        {tabs.map((tab) => (
          <Link
            key={tab.path}
            to={tab.path}
            replace
            className={tab.path === pathname ? 'tabbar-item active' : 'tabbar-item'}
            aria-current={tab.path === pathname ? 'page' : undefined}
          >
            <Icon name={tab.icon} />
            {tab.label}
            {tab.badge && <Count n={badges.data?.[tab.badge] ?? 0} className="tabbar-badge" />}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** Вкладки и переключатель роли; на вложенных экранах их нет, там работает «Назад». */
export function AppShell({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const { pathname } = useLocation();
  const { active, setActive } = useActiveRole();
  const tabs = tabsOf(active);
  const onTab = tabs.some((tab) => tab.path === pathname);

  // Переход по ссылке на вкладку другой роли. Площадки комик открывает из «Ещё», «Карта»
  // есть у двух ролей — роль не меняется.
  useEffect(() => {
    if (onTab || pathname === '/venues' || pathname === '/map') return;
    const role = me.roles.find((r) => TABS[r].some((tab) => tab.path === pathname));
    if (role) setActive(role);
  }, [onTab, pathname, me.roles, setActive]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={onTab ? 'with-tabbar' : undefined}>
      {onTab && me.roles.length > 1 && <RoleSwitch />}
      {children}
      {onTab && <TabBar tabs={tabs} />}
    </div>
  );
}

/** Главная: первая вкладка выбранной роли. */
export function RoleHome() {
  const { active } = useActiveRole();
  return <Navigate to={tabsOf(active)[0]!.path} replace />;
}

export function MoreScreen() {
  const { active } = useActiveRole();
  const { me } = useMe();
  const remove = useMutation({
    mutationFn: api.deleteMe,
    onSuccess: () => {
      setToken(null);
      try {
        localStorage.clear();
      } catch {
        // Хранилище недоступно — чистить нечего.
      }
      haptic('success');
    },
    onError: () => haptic('error'),
  });
  if (remove.isSuccess) {
    return (
      <Screen title={t.account.delete}>
        <p>{t.account.deleted}</p>
      </Screen>
    );
  }
  return (
    <Screen title={t.tabs.more}>
      <nav className="list">
        {me.roles.includes('comedian') && <Link to="/profile">{t.menu.profile}</Link>}
        {me.roles.includes('organizer') && <Link to="/organizer">{t.menu.organizerProfile}</Link>}
        {active !== 'organizer' && <Link to="/venues">{t.menu.venues}</Link>}
        <Link to="/settings">{t.menu.notifications}</Link>
        <Link to="/roles">{t.menu.roles}</Link>
      </nav>
      <section className="account-delete">
        <p className="hint">{t.account.deleteHint}</p>
        <button
          type="button"
          className="secondary danger-text"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(t.account.deleteConfirm)) remove.mutate();
          }}
        >
          {t.account.delete}
        </button>
        {remove.isError && <ErrorText error={remove.error} />}
      </section>
    </Screen>
  );
}
