# Infraestructura y operación

Todo corre con Docker Compose. En el VPS, Caddy recibe el tráfico (HTTPS automático),
sirve el frontend compilado y reenvía `/api`, `/media` y `/health` a la API.

```
internet ──443──▶ web (Caddy + SPA) ──▶ api :3001 ──▶ mongo (rs0) / redis
                                            ▲
                    worker (BullMQ) ────────┤
                    scraper (Python) ── POST http://api:3001/internal/v1/ingest/batches
```

| Servicio | Imagen | Expuesto | Notas |
|---|---|---|---|
| `web` | `pos-celulares-web` (Caddy 2.8 + `frontend/dist`) | 80, 443 | Bloquea `/internal/*` y `/api/*/internal/*` (404) |
| `api` | `pos-celulares-api` (Node 22, usuario `node`) | solo red interna | `GET /health` para healthcheck |
| `worker` | misma imagen que `api`, `node src/worker.js` | no | Perfil `worker` hasta que exista el worker (B8) |
| `scraper` | `pos-celulares-scraper` (Python 3.12) | no | Perfil `scraper`; corre por cron/temporizador |
| `mongo` | `mongo:7`, replica set `rs0` de un nodo | 127.0.0.1 en local, nunca en prod | Transacciones y change streams habilitados |
| `redis` | `redis:7-alpine` con AOF | 127.0.0.1 en local | Colas BullMQ y rate limit |
| `uptime-kuma` | `louislam/uptime-kuma:1` | 127.0.0.1:3002 | Perfil `monitoring`, entrar por túnel SSH |

## Desarrollo local

```bash
cp .env.example .env
# Generar la clave del replica set:
sed -i "s|^MONGO_REPLICA_KEY=.*|MONGO_REPLICA_KEY=$(openssl rand -base64 756 | tr -d '\n')|" .env
docker compose up -d mongo redis          # solo bases de datos
cd backend && cp .env.example .env && npm ci && npm run dev
cd frontend && npm ci && npm run dev      # Vite en :5173 con proxy a :3001
```

Todo en contenedores: `docker compose up -d` (mongo, redis, api) y
`docker compose --profile web up -d` para ver el frontend compilado en http://localhost:8080.

Desde el host, conectar a Mongo con `directConnection=true`
(`mongodb://pos_api:...@localhost:27017/pos?authSource=pos&directConnection=true`),
porque el miembro del replica set se anuncia como `mongo:27017`, que solo resuelve dentro de Docker.

### Usuarios de MongoDB

`infra/mongo/init/01-users.js` se ejecuta solo la primera vez que el volumen está vacío:

- `pos_api`: `readWrite` en la base `pos` (catálogo, inventario, pedidos, pagos…).
- `pos_scraper`: `readWrite` solo en la base `scraping` (páginas y listados crudos/limpios).
  No puede leer ni escribir `pos`; los datos limpios entran a la tienda solo por el endpoint de ingesta.
- `root`: administración y respaldos. La API nunca lo usa.

Para recrear desde cero en local: `docker compose down -v`.

## Variables y secretos

Contrato de variables: `.env.example` en la raíz. La API recibe `MONGO_URI`, `REDIS_URL`,
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `INGEST_API_KEY`, `SENTRY_DSN`, `S3_*`, `PAYPAL_*`, `MP_*`.
El scraper recibe `SCRAPER_MONGO_URI`, `INGEST_URL` e `INGEST_API_KEY`.

- En el servidor: `/opt/pos/.env` (permiso 600, dueño `deploy`). Nunca en el repo.
- En GitHub, environments `staging` y `production` (Settings → Environments), cada uno con:

| Secreto | Valor |
|---|---|
| `SSH_HOST` | IP o dominio del VPS |
| `SSH_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | llave privada ed25519 creada solo para CI |
| `SSH_KNOWN_HOSTS` | salida de `ssh-keyscan -t ed25519 <host>` |
| `GHCR_USER` / `GHCR_READ_TOKEN` | usuario y PAT con `read:packages` para que el VPS descargue imágenes |

`production` debe tener "Required reviewers" para que cada tag `v*` pida aprobación.

## Primer despliegue en un VPS (S4)

1. Crear un VPS Ubuntu 24.04 (2 vCPU / 4 GB es suficiente para empezar) y apuntar el dominio (registro A) a su IP.
2. Como root: `DEPLOY_PUBKEY="ssh-ed25519 AAAA... ci" bash infra/scripts/provision-vps.sh`
   (incluir también la llave personal de quien administre).
3. Como `deploy`: crear `/opt/pos/.env` a partir de `.env.example` con valores reales,
   `DEPLOY_ENV=production`, `SITE_ADDRESS=tu-dominio`, y opcionalmente
   `COMPOSE_PROFILES=worker,scraper,monitoring`.
4. Configurar el remoto de respaldos: `rclone config` → remoto `backups` tipo S3 (Cloudflare R2 o DO Spaces).
5. Cargar los secretos del environment en GitHub y lanzar *Deploy* (manual o con push/tag).
6. Agregar el cron de respaldos (abajo) y el monitor de Uptime Kuma.

Staging es un segundo VPS igual (o uno más chico) con su propio dominio, p. ej. `staging.tu-dominio`.

## CI/CD (S7)

- `.github/workflows/ci.yml` en cada PR: backend (lint, migraciones e índices, Jest contra Mongo y Redis),
  frontend (lint, tests, `vite build`), scraper (ruff, pytest; se activa cuando exista
  `scraper/requirements.txt`), build de imágenes y validación de Caddyfile y compose.
- `.github/workflows/deploy.yml`: build y push a GHCR (`ghcr.io/<owner>/pos-celulares-{api,web,scraper}`),
  copia compose y scripts al servidor y ejecuta `scripts/deploy.sh <tag>`.
  - push a `develop` → staging (tag `sha-xxxxxxx`)
  - tag `v1.2.3` → producción
- `deploy.sh` corre `npm run migrate --if-present` (índices y migraciones de datos, p. ej. con
  `migrate-mongo`) antes de reemplazar la API, espera `/health` y deja escrito cómo volver atrás.

**Rollback:** `ssh deploy@host 'bash /opt/pos/scripts/deploy.sh <tag-anterior>'`.

### Ramas (S1)

- `main`: producción, protegida, solo por PR con CI verde. Los releases se marcan con tag `v*`.
- `develop`: integración, se despliega sola a staging.
- `feature/<equipo>-<tema>` (p. ej. `feature/back-catalogo`, `feature/scrap-spider-x`): PR hacia `develop`.

## Respaldos (S8)

`scripts/backup.sh` hace `mongodump --oplog` de toda la instancia a un `.archive.gz`,
lo sube a `backups:$BACKUP_BUCKET/<entorno>/` y borra lo que tenga más de 14 días.

```cron
15 3 * * * /opt/pos/scripts/backup.sh >> /opt/pos/backups/backup.log 2>&1
```

Prueba de restauración mensual: `scripts/restore-test.sh` restaura el último respaldo en un
contenedor temporal y lista documentos por colección. Restauración real:
`docker compose -f docker-compose.prod.yml exec -T mongo mongorestore --archive --gzip --drop --oplogReplay -u root -p ... --authenticationDatabase admin < archivo.archive.gz`.

Las imágenes de productos viven en el bucket S3 (R2/Spaces), con versionado activado en el bucket.

## Monitoreo y logs (S9)

- **Sentry:** `SENTRY_DSN` para api y worker, `SCRAPER_SENTRY_DSN` para el scraper. El backend inicializa
  `@sentry/node` si la variable existe; `SENTRY_ENVIRONMENT` toma `DEPLOY_ENV`.
- **Uptime Kuma:** `ssh -L 3002:localhost:3002 deploy@host` y abrir http://localhost:3002.
  Monitores: `https://tu-dominio/health` cada 60 s y el dominio raíz. Alertas a correo o Telegram.
- **Logs:** todos los contenedores usan `json-file` con rotación (10 MB × 5). Ver con
  `docker compose -f docker-compose.prod.yml logs -f api`. Caddy y la API escriben JSON (pino).

## Contrato con los otros equipos

- **Backend:** escucha en `PORT=3001`, expone `GET /health` (200 si Mongo y Redis responden),
  lee `MONGO_URI` y `REDIS_URL`, define `npm run migrate` (índices) y `src/worker.js` para BullMQ.
  Las rutas internas viven bajo `/internal/v1/*` y exigen `INGEST_API_KEY`.
- **Scraper:** `scraper/requirements.txt`, módulo ejecutable `python -m scraper`, tests con pytest.
  Publica a `INGEST_URL` con `Idempotency-Key`; su base propia es `scraping`.
- **Frontend:** `npm run build` genera `frontend/dist`; las llamadas van a rutas relativas `/api/v1/...`
  (variable `VITE_API_URL`, por defecto `/api`).
