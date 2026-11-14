/** Адрес для логов: токены ленты календаря и ссылок записи заменены на ***. */
export function redactUrl(url: string): string {
  return url
    .replace(/^(\/cal\/)[^?]*/, '$1***')
    .replace(/^(\/api\/v1\/events\/by-link\/)[^/?]*/, '$1***');
}
