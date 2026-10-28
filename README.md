# Stand Up Calendar

Telegram Mini App и бот для комиков, организаторов и ведущих стендап-мероприятий. ТЗ — [SPEC.md](SPEC.md).

## Быстрый старт

```sh
cp .env.example .env      # заполнить BOT_TOKEN, BOT_USERNAME, MINIAPP_URL
docker compose up --build
```

| Сервис                           | Адрес                        |
| -------------------------------- | ---------------------------- |
| Mini App (nginx + прокси на API) | http://localhost:8080        |
| API                              | http://localhost:3000/api/v1 |
| MinIO console                    | http://localhost:9001        |

Без `BOT_TOKEN` система тоже поднимается: бот пишет предупреждение и не запускается, а в Mini App, открытом в браузере, работает dev-вход (`DEV_AUTH=true`).

### Podman

На Windows с Podman Docker-совместимый API машины может не отвечать, и `docker compose` / `podman compose` (который вызывает тот же `docker-compose`) зависают. Рабочий вариант — собрать образы самим Podman и поднять стек через `podman-compose`:

```sh
pip install --user podman-compose
podman build --target node-app -t localhost/standup-calendar-node:dev .
podman build --target miniapp -t localhost/standup-calendar-miniapp:dev .
python -m podman_compose up -d --no-build
```

Postgres проброшен на порт **5442** (5432 часто занят локальной установкой). MinIO — образ `bitnamilegacy/minio`: официальные образы MinIO больше не публикуются в открытых реестрах.

### Открыть Mini App из Telegram в dev

Telegram открывает Mini App только по https. Поднимите туннель на порт 8080, например:

```sh
cloudflared tunnel --url http://localhost:8080
```

и пропишите выданный https-адрес в `.env` как `MINIAPP_URL`, затем `docker compose up -d bot`. После `/start` бот покажет кнопку «Открыть приложение» и установит кнопку меню.

Для ссылок вида `t.me/<bot>/<app>?startapp=...` зарегистрируйте Mini App в @BotFather (`/newapp`) с тем же URL и укажите `MINIAPP_SHORT_NAME`.

## Разработка

```sh
pnpm install
docker compose up -d postgres redis minio
pnpm db:migrate
pnpm seed                 # демо-данные; войти dev-входом можно под любым telegram_id из сида
pnpm dev                  # api :3000, bot, worker, miniapp :5173
pnpm check                # lint + format + typecheck + test
pnpm test:coverage        # покрытие packages/domain (порог 90%)
```

Интеграционные тесты API идут против Postgres из `TEST_DATABASE_URL` (по умолчанию в `.env.example` — тот же Postgres на 5442); без переменной они пропускаются.
