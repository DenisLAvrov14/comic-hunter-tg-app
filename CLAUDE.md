# Stand Up Calendar

Telegram Mini App + бот для стендап-индустрии. Полное ТЗ — [SPEC.md](SPEC.md), прогресс — [docs/PROGRESS.md](docs/PROGRESS.md).

## Как работать

- Работай **строго по этапам** из SPEC.md §12. Следующий этап — только после выполнения критериев приёмки текущего.
- В конце этапа: `pnpm check` зелёный, `docker compose up` поднимает рабочую систему, в `docs/PROGRESS.md` записано, что сделано и что отложено.
- «Вне MVP» (SPEC §13) не делать без запроса, но модель данных закладывать с запасом.
- Неоднозначность: смотри SPEC §14; нет ответа — самый простой вариант + `// TODO(spec): ...` в коде + вопрос в §14.
- Бизнес-логика — только в `packages/domain`, чистыми функциями, с unit-тестами обязательно.
- Все тексты UI и бота — в `packages/shared/src/i18n/ru.ts`.
- Схема БД меняется только через Drizzle: правка `packages/db/src/schema.ts` → `pnpm db:generate` → закоммитить SQL из `packages/db/drizzle`.
- Время в БД — `timestamptz` (UTC). В бизнес-логике никаких `new Date().getHours()`; таймзоны — через `date-fns-tz`/Temporal.
- Не логировать токены и `initData`.

## Команды

```sh
pnpm install
pnpm check            # lint + format:check + typecheck + test
pnpm test             # vitest; интеграционные тесты запускаются, если задан TEST_DATABASE_URL
pnpm db:generate      # сгенерировать миграцию из schema.ts
pnpm db:migrate       # применить миграции (DATABASE_URL)
pnpm dev              # все apps локально (инфраструктура — docker compose up postgres redis minio)
docker compose up --build
```

## Структура

- `apps/api` — Fastify, префикс `/api/v1`, ошибки `{ error: { code, message, details? } }` через `ApiError`.
- `apps/bot` — grammY (polling в dev, webhook в prod).
- `apps/worker` — планировщик уведомлений (этап 6).
- `apps/miniapp` — React + Vite + `@telegram-apps/sdk-react` v3.
- `packages/db` — схема, миграции, репозитории; реэкспортирует `eq/and/sql` из drizzle.
- `packages/domain` — чистая логика.
- `packages/shared` — Zod-схемы API и i18n.

Пакеты экспортируют исходники `.ts` напрямую (без сборки); Node-сервисы запускаются через `tsx`.
