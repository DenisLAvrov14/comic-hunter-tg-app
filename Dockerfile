# Один образ для всех Node-сервисов (api, bot, worker, migrate); команда задаётся в compose.
FROM node:22-alpine AS base
RUN npm install -g pnpm@10.33.4
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/bot/package.json apps/bot/
COPY apps/worker/package.json apps/worker/
COPY apps/miniapp/package.json apps/miniapp/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/notify/package.json packages/notify/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .

FROM base AS node-app
ENV NODE_ENV=production

FROM base AS miniapp-build
RUN pnpm --filter @standup/miniapp build

FROM nginx:1.27-alpine AS miniapp
COPY apps/miniapp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=miniapp-build /app/apps/miniapp/dist /usr/share/nginx/html
