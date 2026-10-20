#!/usr/bin/env bash
# Se ejecuta EN el servidor (lo invoca el workflow de deploy por SSH).
#   deploy.sh <image_tag>
# Descarga imágenes, aplica migraciones (índices) y reinicia servicios sin bajar mongo.
set -euo pipefail

TAG="${1:?uso: deploy.sh <image_tag>}"
APP_DIR="${APP_DIR:-/opt/pos}"
cd "$APP_DIR"

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)
# Perfiles opcionales activados en el servidor, p. ej. COMPOSE_PROFILES=worker,scraper,monitoring en .env
set -a; . ./.env; set +a

# Guarda el tag previo para poder volver atrás.
PREV_TAG="$(grep -E '^IMAGE_TAG=' .env | cut -d= -f2- || true)"
sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${TAG}|" .env
grep -q '^IMAGE_TAG=' .env || echo "IMAGE_TAG=${TAG}" >> .env

echo "Desplegando ${TAG} (anterior: ${PREV_TAG:-ninguno})"
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d mongo redis

# Migraciones/índices: el backend define "migrate" en package.json (p. ej. migrate-mongo). Si aún no
# existe, npm --if-present no falla.
if ! "${COMPOSE[@]}" run --rm --no-deps api npm run migrate --if-present; then
  echo "Falló la migración; se restaura IMAGE_TAG=${PREV_TAG}" >&2
  sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${PREV_TAG}|" .env
  exit 1
fi

"${COMPOSE[@]}" up -d --remove-orphans

# Espera a que la API responda /api/v1/health (hasta 2 min).
for _ in $(seq 1 24); do
  if "${COMPOSE[@]}" exec -T api wget -qO- http://127.0.0.1:3001/api/v1/health >/dev/null 2>&1; then
    echo "API sana con ${TAG}"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done

echo "La API no respondió /api/v1/health; revisar: ${COMPOSE[*]} logs api" >&2
echo "Para volver atrás: deploy.sh ${PREV_TAG}" >&2
exit 1
