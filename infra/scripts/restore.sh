#!/usr/bin/env bash
# Restaura un respaldo de MongoDB sobre el stack del APP_DIR indicado (S9).
#   APP_DIR=/opt/crm-staging restore.sh backups/mongo-production-<fecha>.archive.gz
# Uso típico: prueba mensual restaurando el respaldo de producción en STAGING.
# Reemplaza (--drop) las colecciones del archivo; pide confirmación.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/crm-staging}"
DUMP="${1:?uso: restore.sh <archivo.archive.gz>}"
cd "$APP_DIR"
set -a; . ./.env; set +a
[[ -f "$DUMP" ]] || { echo "No existe $DUMP" >&2; exit 1; }

SRC_DB="${SRC_DB_NAME:-crm_celulares}"
DST_DB="${MONGO_DB_NAME:-crm_celulares}"

echo "Se va a restaurar $DUMP sobre $APP_DIR (base ${SRC_DB} -> ${DST_DB}, entorno ${DEPLOY_ENV:-?})."
read -r -p "Escribe RESTAURAR para continuar: " ok
[[ "$ok" == "RESTAURAR" ]] || { echo "Cancelado"; exit 1; }

docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env exec -T mongo \
  mongorestore --archive --gzip --drop \
    --username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
    --nsInclude "${SRC_DB}.*" --nsFrom "${SRC_DB}.*" --nsTo "${DST_DB}.*" < "$DUMP"

echo "Restaurado. Revisa: curl -s http://127.0.0.1:${HTTP_LOCAL_PORT:-8080}/api/v1/health"
