#!/usr/bin/env bash
# Respaldo diario de MongoDB e imágenes (S9). Cron del usuario deploy:
#   15 3 * * * /opt/crm/infra/scripts/backup.sh >> /opt/crm/backups/backup.log 2>&1
# Genera un .archive.gz con toda la instancia de Mongo (incluye usuarios) y un
# .tar.gz con las imágenes; los deja en backups/ (SSD) y, si hay S3_* en .env,
# los copia a Cloudflare R2 fuera de la casa.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/crm}"
cd "$APP_DIR"
set -a; . ./.env; set +a

BUCKET="${BACKUP_BUCKET:-${S3_BUCKET:-}}"
ENV_NAME="${DEPLOY_ENV:-production}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="backups/mongo-${ENV_NAME}-${STAMP}.archive.gz"

# Remoto rclone "s3backup" definido solo con variables de entorno (sin rclone config).
export RCLONE_CONFIG_S3BACKUP_TYPE=s3
export RCLONE_CONFIG_S3BACKUP_PROVIDER="${BACKUP_S3_PROVIDER:-Other}"
export RCLONE_CONFIG_S3BACKUP_ENDPOINT="${S3_ENDPOINT:-}"
export RCLONE_CONFIG_S3BACKUP_ACCESS_KEY_ID="${S3_ACCESS_KEY:-}"
export RCLONE_CONFIG_S3BACKUP_SECRET_ACCESS_KEY="${S3_SECRET_KEY:-}"
export RCLONE_CONFIG_S3BACKUP_NO_CHECK_BUCKET=true

# --oplog: foto consistente aunque haya escrituras durante el dump (requiere replica set).
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env exec -T mongo \
  mongodump --quiet --archive --gzip --oplog \
    --username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin > "$FILE"

# Un respaldo vacío o truncado no cuenta.
if [[ ! -s "$FILE" ]] || ! gzip -t "$FILE"; then echo "Respaldo inválido: $FILE" >&2; exit 1; fi

# Imágenes de productos (volumen media-data).
MEDIA="backups/media-${ENV_NAME}-${STAMP}.tar.gz"
PROJECT="${COMPOSE_PROJECT_NAME:-crm-celulares}"
docker run --rm -v "${PROJECT}_media-data:/media:ro" alpine tar czf - -C /media . > "$MEDIA"

# Copia local en el SSD: 14 días. Copia fuera de casa (R2): misma retención.
find backups -name '*.archive.gz' -mtime +"$RETENTION" -delete
find backups -name 'media-*.tar.gz' -mtime +"$RETENTION" -delete

if [[ -n "${S3_ENDPOINT:-}" ]]; then
  DEST="s3backup:${BUCKET}/backups/${ENV_NAME}/"
  rclone copy "$FILE" "$DEST"
  rclone copy "$MEDIA" "$DEST"
  rclone delete "$DEST" --min-age "${RETENTION}d"
  echo "$(date -u +%FT%TZ) OK $FILE $MEDIA -> $DEST"
else
  echo "$(date -u +%FT%TZ) OK $FILE $MEDIA (solo local; sin S3_ENDPOINT no hay copia externa)"
fi
