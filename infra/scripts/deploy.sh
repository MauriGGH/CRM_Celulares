#!/usr/bin/env bash
# Se ejecuta EN la Raspberry Pi (lo invoca el runner de GitHub Actions).
#   APP_DIR=/opt/crm deploy.sh <image_tag>
# Descarga la imagen del backend, reinicia servicios sin bajar mongo y espera
# a que /api/v1/health responda. Si falla, deja dicho cómo volver atrás.
set -euo pipefail

TAG="${1:?uso: deploy.sh <image_tag>}"
APP_DIR="${APP_DIR:-/opt/crm}"
cd "$APP_DIR"

# COMPOSE_PROJECT_NAME, COMPOSE_PROFILES, etc. salen del .env de cada entorno
# (staging en la misma Pi usa COMPOSE_PROJECT_NAME=crm-staging).
set -a; . ./.env; set +a

COMPOSE=(docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env)

[[ -s infra/secrets/mongo-keyfile ]] || { echo "Falta infra/secrets/mongo-keyfile (correr provision.sh)" >&2; exit 1; }

# Guarda el tag previo para poder volver atrás.
PREV_TAG="$(grep -E '^IMAGE_TAG=' .env | cut -d= -f2- || true)"
if grep -q '^IMAGE_TAG=' .env; then
  sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${TAG}|" .env
else
  echo "IMAGE_TAG=${TAG}" >> .env
fi

echo "Desplegando ${TAG} (anterior: ${PREV_TAG:-ninguno})"
"${COMPOSE[@]}" pull api worker cloudflared
"${COMPOSE[@]}" up -d mongo mongo-init redis

# Migraciones de datos o índices, si el backend define "migrate" en package.json.
if ! "${COMPOSE[@]}" run --rm --no-deps api npm run migrate --if-present; then
  echo "Falló la migración; se restaura IMAGE_TAG=${PREV_TAG}" >&2
  sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${PREV_TAG}|" .env
  exit 1
fi

"${COMPOSE[@]}" up -d --remove-orphans

# Espera a que la API responda (hasta 2 min).
for _ in $(seq 1 24); do
  if "${COMPOSE[@]}" exec -T api wget -qO- http://127.0.0.1:3001/api/v1/health >/dev/null 2>&1; then
    echo "API sana con ${TAG}"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done

echo "La API no respondió /api/v1/health; revisar: ${COMPOSE[*]} logs api" >&2
echo "Para volver atrás: bash $APP_DIR/infra/scripts/deploy.sh ${PREV_TAG}" >&2
exit 1
