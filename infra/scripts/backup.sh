#!/usr/bin/env bash
# Respaldo diario de MongoDB (S8). Cron del usuario deploy:
#   15 3 * * * /opt/pos/scripts/backup.sh >> /opt/pos/backups/backup.log 2>&1
# Genera un único archivo .archive.gz con toda la instancia.
# Requiere un remoto rclone llamado "backups" (R2 o Spaces) y BACKUP_BUCKET en .env.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/pos}"
cd "$APP_DIR"
set -a; . ./.env; set +a

: "${BACKUP_BUCKET:?falta BACKUP_BUCKET en .env}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="backups/mongo-${DEPLOY_ENV:-production}-${STAMP}.archive.gz"

# Respaldo completo de la instancia (tienda, scraping y usuarios de admin).
# --oplog da una foto consistente en el momento del dump (requiere replica set).
docker compose -f docker-compose.prod.yml --env-file .env exec -T mongo \
  mongodump --quiet --archive --gzip --oplog \
    --username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin > "$FILE"

# Un respaldo vacío o truncado no cuenta.
if [[ ! -s "$FILE" ]] || ! gzip -t "$FILE"; then echo "Respaldo inválido: $FILE" >&2; exit 1; fi

rclone copy "$FILE" "backups:${BACKUP_BUCKET}/${DEPLOY_ENV:-production}/"
rclone delete "backups:${BACKUP_BUCKET}/${DEPLOY_ENV:-production}/" --min-age "${RETENTION}d"
find backups -name '*.archive.gz' -mtime +3 -delete

echo "$(date -u +%FT%TZ) OK $FILE"
