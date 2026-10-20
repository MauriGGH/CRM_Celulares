#!/bin/bash
# Healthcheck que además inicia el replica set la primera vez.
# El host del miembro es "mongo:27017", el nombre del servicio en compose.
mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin --eval '
try {
  rs.status().ok
} catch (e) {
  rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] }).ok
}' | grep -q 1
