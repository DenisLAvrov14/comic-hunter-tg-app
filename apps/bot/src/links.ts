/** Прямая ссылка на Mini App: работает и в группах, где web_app-кнопки недоступны. */
export function miniAppDirectLink(
  botUsername: string,
  appShortName: string,
  startParam?: string,
): string | null {
  if (!botUsername || !appShortName) return null;
  const base = `https://t.me/${botUsername}/${appShortName}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}

/** Параметры startapp: e_<event>, j_<link token>, i_<invitation>. */
export function isValidStartParam(value: string): boolean {
  return /^[eji]_[A-Za-z0-9_-]{1,64}$/.test(value);
}
