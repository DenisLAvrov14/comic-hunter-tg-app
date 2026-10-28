import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthResponse, Me } from '@standup/shared';
import { api, setToken } from './api';
import type { TelegramEnv } from './telegram';

const DEV_TOKEN_KEY = 'standup.devToken';

type AuthState =
  | { status: 'loading' }
  | { status: 'authenticated'; user: Me; startParam: string | null }
  | { status: 'dev-login' }
  | { status: 'not-in-telegram' }
  | { status: 'error'; message: string };

interface AuthContextValue {
  state: AuthState;
  devLogin: (telegramId: number, firstName: string) => Promise<void>;
  retry: () => void;
  /** Обновляет пользователя после изменений профиля (ответы API возвращают свежий Me). */
  setUser: (user: Me) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readDevToken(): string | null {
  try {
    return localStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeDevToken(value: string) {
  try {
    localStorage.setItem(DEV_TOKEN_KEY, value);
  } catch {
    // Хранилище недоступно — dev-вход просто не переживёт перезагрузку.
  }
}

export function AuthProvider({ tg, children }: { tg: TelegramEnv; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const accept = useCallback((res: AuthResponse) => {
    setToken(res.token);
    setState({ status: 'authenticated', user: res.user, startParam: res.startParam });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setState({ status: 'loading' });
      try {
        if (tg.initData) {
          const res = await api.authTelegram(tg.initData);
          if (!cancelled) accept(res);
          return;
        }
        const { devAuth } = await api.authConfig();
        if (!devAuth) {
          if (!cancelled) setState({ status: 'not-in-telegram' });
          return;
        }
        const saved = readDevToken();
        if (saved) {
          setToken(saved);
          const user = await api.me().catch(() => null);
          if (user) {
            if (!cancelled) setState({ status: 'authenticated', user, startParam: null });
            return;
          }
          setToken(null);
        }
        if (!cancelled) setState({ status: 'dev-login' });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: (e as Error).message });
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [tg.initData, attempt, accept]);

  const devLogin = useCallback(
    async (telegramId: number, firstName: string) => {
      const res = await api.authDev({ telegramId, firstName });
      writeDevToken(res.token);
      accept(res);
    },
    [accept],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const setUser = useCallback(
    (user: Me) => setState((prev) => (prev.status === 'authenticated' ? { ...prev, user } : prev)),
    [],
  );

  return (
    <AuthContext.Provider value={{ state, devLogin, retry, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Текущий пользователь на экранах, доступных только после входа. */
export function useMe(): { me: Me; setUser: (user: Me) => void } {
  const { state, setUser } = useAuth();
  if (state.status !== 'authenticated') throw new Error('useMe requires authenticated state');
  return { me: state.user, setUser };
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
