#!/usr/bin/env bash
# Prueba de restauración (S8): restaura el respaldo más reciente en un MongoDB
# temporal y cuenta documentos por colección. Correr al menos una vez al mes.
#   restore-test.sh [archivo.archive.gz]
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/pos}"
cd "$APP_DIR"
set -a; . ./.env; set +a

DUMP="${1:-$(ls -1t backups/*.archive.gz | head -1)}"
[[ -f "$DUMP" ]] || { echo "No hay respaldo local; bájalo con rclone copy" >&2; exit 1; }

NAME="pos-restore-test-$$"
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" mongo:7 >/dev/null
for _ in $(seq 1 30); do
  docker exec "$NAME" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1 && break
  sleep 2
done

docker exec -i "$NAME" mongorestore --quiet --archive --gzip --drop --oplogReplay < "$DUMP"

echo "Restauración de $DUMP correcta. Documentos por colección:"
docker exec "$NAME" mongosh --quiet --eval "
for (const name of ['${APP_DB_NAME}', '${SCRAPER_DB_NAME}']) {
  const d = db.getSiblingDB(name);
  for (const c of d.getCollectionNames()) print(name + '.' + c + ': ' + d[c].estimatedDocumentCount());
}"
