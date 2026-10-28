/** Как открыть Mini App из сообщения. */
export interface LinkConfig {
  botUsername: string;
  miniAppShortName: string;
}

/** Прямая ссылка t.me/<bot>/<app>?startapp=... или null, если Mini App не зарегистрирован. */
export function appLink(cfg: LinkConfig, startParam?: string): string | null {
  if (!cfg.botUsername || !cfg.miniAppShortName) return null;
  const base = `https://t.me/${cfg.botUsername.replace(/^@/, '')}/${cfg.miniAppShortName}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}
