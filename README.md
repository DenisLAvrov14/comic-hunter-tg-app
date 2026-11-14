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

## Проверка в Telegram

1. Поднять https-туннель на Mini App: `cloudflared tunnel --url http://localhost:8080` (или ngrok).
2. В `.env`: `MINIAPP_URL=<https-адрес>`, `PUBLIC_BASE_URL=<тот же адрес>` (ссылки на ICS).
3. В @BotFather: `/newapp` → выбрать бота → URL = `MINIAPP_URL` → short name → прописать в `.env` как `MINIAPP_SHORT_NAME`.
4. Перезапустить api, bot, worker, miniapp. В боте: `/start` → «Открыть приложение».
5. Анонсы: добавить бота в свою группу (в канал — админом с правом публикации) → в Mini App на экране состава «Опубликовать в чат».

## Деплой

Боевой стек — [docker-compose.prod.yml](docker-compose.prod.yml): Postgres, Redis, MinIO, api, bot (webhook), worker, nginx Mini App и [Caddy](deploy/Caddyfile) с автоматическим сертификатом Let's Encrypt. Наружу открыты только 80 и 443.

Требования к серверу: Linux, Docker с compose-плагином, 2 ГБ RAM, домен с A-записью на сервер.

```sh
git clone <repo> /opt/standup_calendar && cd /opt/standup_calendar
cp .env.production.example .env   # заполнить; секреты — openssl rand -hex 32
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps    # migrate — Exited (0), остальные Up
curl https://<DOMAIN>/health                    # {"ok":true}
```

Без любой обязательной переменной compose не стартует и называет её. API не стартует с `DEV_AUTH=true` в production.

В @BotFather: Mini App (`/newapp` или «Edit Web App URL») → `https://<DOMAIN>`, short name → `MINIAPP_SHORT_NAME`. Вебхук бот регистрирует сам при каждом старте (`https://<DOMAIN>/bot/webhook` с `BOT_WEBHOOK_SECRET`). Один токен — один получатель обновлений: dev-бот в режиме polling на том же токене снимет вебхук, поэтому для разработки заведите отдельного бота.

Обновление:

```sh
git pull
docker compose -f docker-compose.prod.yml up -d --build   # migrate применит новые миграции
```

Логи: `docker compose -f docker-compose.prod.yml logs -f api worker bot` (ротация — 5 × 20 МБ на сервис).

### Бэкапы

[deploy/backup.sh](deploy/backup.sh) — дамп Postgres (`pg_dump -Fc`) и архив фото из MinIO в `BACKUP_DIR` (по умолчанию `/var/backups/standup`), хранит 14 дней. В cron:

```sh
30 3 * * * cd /opt/standup_calendar && ./deploy/backup.sh >> /var/log/standup_calendar-backup.log 2>&1
```

Копии стоит регулярно уносить с сервера (rsync/rclone в другое хранилище).

Восстановление:

```sh
C="docker compose -f docker-compose.prod.yml"
$C stop api bot worker
$C exec -T postgres pg_restore -U standup -d standup --clean --if-exists < db-<stamp>.dump
docker run --rm -i --volumes-from "$($C ps -q minio)" alpine:3.20 \
  tar -C /bitnami/minio/data -xzf - < media-<stamp>.tar.gz
$C start api bot worker
```

### Внешнее S3 вместо MinIO

Задать `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, ключи, `S3_PUBLIC_URL` (публичный адрес бакета) и `S3_CREATE_BUCKET=false`; бакет должен отдавать `photos/*` на чтение. Сервис `minio` и `location /media/` в [nginx.conf](apps/miniapp/nginx.conf) тогда не нужны.

## Разработка

```sh
pnpm install
docker compose up -d postgres redis minio
pnpm db:migrate
pnpm seed                 # демо-данные; войти dev-входом можно под любым telegram_id из сида
pnpm seed:catalog         # реальные площадки и демо-профили публичных комиков для ручной проверки
pnpm dev                  # api :3000, bot, worker, miniapp :5173
pnpm check                # lint + format + typecheck + test
pnpm test:coverage        # покрытие packages/domain (порог 90%)
```

Интеграционные тесты API идут против Postgres из `TEST_DATABASE_URL` (по умолчанию в `.env.example` — тот же Postgres на 5442); без переменной они пропускаются.
