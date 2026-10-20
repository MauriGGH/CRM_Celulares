#!/bin/bash
# Arranca mongod como replica set de un nodo (rs0) con autenticación.
# El replica set habilita transacciones multi-documento (reserva de stock,
# checkout) y change streams. El keyFile es obligatorio con auth + replSet;
# se genera desde MONGO_REPLICA_KEY para no versionarlo.
set -euo pipefail
: "${MONGO_REPLICA_KEY:?falta MONGO_REPLICA_KEY (openssl rand -base64 756 | tr -d '\n')}"
printf '%s' "$MONGO_REPLICA_KEY" > /data/keyfile
chmod 400 /data/keyfile
chown 999:999 /data/keyfile
exec docker-entrypoint.sh mongod --replSet rs0 --keyFile /data/keyfile --bind_ip_all
