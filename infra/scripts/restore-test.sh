#!/usr/bin/env bash
# Prueba de restauración (S8): restaura el respaldo más reciente en un MongoDB
# temporal y cuenta documentos por colección. Correr al menos una vez al mes.
#   restore-test.sh [archivo.archive.gz]
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/crm}"
cd "$APP_DIR"
DUMP="${1:-$(ls -1t backups/*.archive.gz | head -1)}"
[[ -f "$DUMP" ]] || { echo "No hay respaldo local en backups/" >&2; exit 1; }
MONGO_IMAGE="$(grep -E '^MONGO_IMAGE=' .env 2>/dev/null | cut -d= -f2- | awk '{print $1}')"

NAME="crm-restore-test-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" "${MONGO_IMAGE:-mongo:8.0}" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$NAME" sh -c 'S=$(command -v mongosh || command -v mongo); $S --quiet --eval "db.runCommand({ ping: 1 }).ok"' >/dev/null 2>&1 && break
  sleep 2
done

docker exec -i "$NAME" mongorestore --quiet --archive --gzip --drop --oplogReplay < "$DUMP"

echo "Restauración de $DUMP correcta. Documentos por colección:"
docker exec "$NAME" sh -c 'S=$(command -v mongosh || command -v mongo); exec $S --quiet --eval "$0"' "
const d = db.getSiblingDB('${SRC_DB_NAME:-crm_celulares}');
for (const c of d.getCollectionNames()) print(c + ': ' + d[c].estimatedDocumentCount());"
