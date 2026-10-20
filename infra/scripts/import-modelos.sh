#!/usr/bin/env bash
# Importa el catálogo de modelos (infra/mongo/seed/modelos.json, 100 teléfonos de GSMArena
# que entregó el equipo de base de datos) a la colección "modelos" del Mongo del stack.
# Idempotente: hace upsert por el campo "id".
#   bash infra/scripts/import-modelos.sh          # local (infra/docker-compose.yml)
#   bash infra/scripts/import-modelos.sh prod     # Pi (con auth, usa MONGO_ROOT_*)
set -euo pipefail

cd "$(dirname "$0")/../.."
FILE=infra/mongo/seed/modelos.json
DB="${MONGO_DB_NAME:-crm_celulares}"

COMPOSE=(docker compose -f infra/docker-compose.yml)
AUTH=()
if [[ "${1:-}" == "prod" ]]; then
  set -a; . ./.env; set +a
  DB="${MONGO_DB_NAME:-crm_celulares}"
  COMPOSE+=(-f infra/docker-compose.prod.yml)
  AUTH=(--username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin)
fi
COMPOSE+=(--env-file .env)

"${COMPOSE[@]}" exec -T mongo mongoimport "${AUTH[@]}" --db "$DB" --collection modelos \
  --jsonArray --mode upsert --upsertFields id < "$FILE"
echo "Importados $(python3 -c "import json;print(len(json.load(open('$FILE'))))" 2>/dev/null || echo '?') modelos en $DB.modelos"
