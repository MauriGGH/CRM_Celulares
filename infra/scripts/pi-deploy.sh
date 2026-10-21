#!/usr/bin/env bash
# Despliegue simple en la Raspberry Pi: git pull y reconstruir en la propia Pi.
# Correr desde el clon del repo (p. ej. ~/pi/docker/CRM_Celulares):
#   bash infra/scripts/pi-deploy.sh            # rama actual
#   BRANCH=develop bash infra/scripts/pi-deploy.sh
# La primera vez crea el keyFile de MongoDB (pide sudo para dárselo al uid 999).
set -euo pipefail

cd "$(dirname "$0")/../.."
[[ -f .env ]] || { echo "Falta .env en $(pwd): cp .env.example .env y llenarlo (ver infra/README.md)" >&2; exit 1; }

if [[ -n "${BRANCH:-}" ]]; then git checkout "$BRANCH"; fi
git pull --ff-only

KEYFILE=infra/secrets/mongo-keyfile
if [[ ! -s "$KEYFILE" ]]; then
  mkdir -p infra/secrets
  openssl rand -base64 756 > "$KEYFILE"
  sudo chown 999:999 "$KEYFILE"
  sudo chmod 400 "$KEYFILE"
  echo "keyFile de MongoDB creado en $KEYFILE"
fi

COMPOSE=(docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env)
"${COMPOSE[@]}" up -d --build --remove-orphans

echo "Esperando /api/v1/health ..."
for _ in $(seq 1 36); do
  if "${COMPOSE[@]}" exec -T api wget -qO- http://127.0.0.1:3001/api/v1/health >/dev/null 2>&1; then
    echo "Listo: API sana ($(git rev-parse --short HEAD))"
    docker image prune -f >/dev/null
    exit 0
  fi
  sleep 5
done
echo "La API no respondió; revisar: ${COMPOSE[*]} logs api" >&2
exit 1
