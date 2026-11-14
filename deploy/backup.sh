#!/bin/sh
# Ежедневный бэкап боевого стека: дамп Postgres и архив фото из MinIO.
# Запуск из корня репозитория на сервере; cron (03:30 каждый день):
#   30 3 * * * cd /opt/standup_calendar && ./deploy/backup.sh >> /var/log/standup_calendar-backup.log 2>&1
# Восстановление — README, раздел «Деплой → Бэкапы».
set -eu

COMPOSE="docker compose -f docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/standup_calendar}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$BACKUP_DIR"
umask 077

echo "[$STAMP] postgres"
$COMPOSE exec -T postgres pg_dump -U standup -d standup --format=custom \
  > "$BACKUP_DIR/db-$STAMP.dump.tmp"
mv "$BACKUP_DIR/db-$STAMP.dump.tmp" "$BACKUP_DIR/db-$STAMP.dump"

MINIO_ID="$($COMPOSE ps -q minio || true)"
if [ -n "$MINIO_ID" ]; then
  echo "[$STAMP] photos"
  docker run --rm --volumes-from "$MINIO_ID" alpine:3.20 \
    tar -C /bitnami/minio/data -czf - . > "$BACKUP_DIR/media-$STAMP.tar.gz.tmp"
  mv "$BACKUP_DIR/media-$STAMP.tar.gz.tmp" "$BACKUP_DIR/media-$STAMP.tar.gz"
fi

find "$BACKUP_DIR" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'media-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "[$STAMP] done"
