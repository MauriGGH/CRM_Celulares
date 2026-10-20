# Infraestructura y operación

Todo corre con Docker Compose. En el VPS, Caddy recibe el tráfico (HTTPS automático),
sirve el frontend compilado y reenvía `/api` y `/media` a la API.

```
internet ──443──▶ web (Caddy + SPA) ──▶ api :3001 ──▶ mongo (rs0) / redis
                                            ▲
                    worker (BullMQ) ────────┤
                    scraper (Python) ── POST http://api:3001/internal/v1/ingest/batches
```

| Servicio | Imagen | Expuesto | Notas |
|---|---|---|---|
| `web` (prod) / `caddy` (local) | Caddy 2.8 + `frontend/dist` | 80, 443 | Bloquea `/internal/*` y `/api/*/internal/*` (404) |
| `api` | `pos-celulares-api` (Node 22, usuario `node`) | solo red interna | `GET /api/v1/health` para healthcheck |
| `worker` | misma imagen que `api`, `node src/worker.js` | no | Perfil `worker` hasta que exista el worker (B8) |
| `scraper` | `pos-celulares-scraper` (Python 3.12) | no | Perfil `scraper`; corre por cron/temporizador |
| `mongo` | `mongo:7`, replica set `rs0` de un nodo, en nuestro VPS | solo 127.0.0.1 (túnel SSH) | Transacciones y change streams habilitados |
| `redis` | `redis:7-alpine` con AOF | 127.0.0.1 en local | Colas BullMQ y rate limit |
| `uptime-kuma` | `louislam/uptime-kuma:1` | 127.0.0.1:3002 | Perfil `monitoring`, entrar por túnel SSH |

## Desarrollo local

```bash
cp .env.example .env
# Generar la clave del replica set:
sed -i "s|^MONGO_REPLICA_KEY=.*|MONGO_REPLICA_KEY=$(openssl rand -base64 756 | tr -d '\n')|" .env
docker compose up -d                      # mongo, redis, api y caddy
curl http://localhost/api/v1/health       # 200 cuando la API está arriba
```

`compose.yaml` en la raíz incluye `infra/docker-compose.yml`. Si el puerto 80 está ocupado,
cambiar `HTTP_PORT` en `.env`. Caddy sirve `frontend/dist` cuando el equipo de frontend lo compile.

Recarga en caliente del backend: `docker compose up -d mongo redis` y
`cd backend && cp .env.example .env && npm ci && npm run dev`.

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
2. Como root: `DEPLOY_PUBKEY="ssh-ed25519 AAAA... ci" bash infra/scripts/provision.sh`
   (incluir también la llave personal de quien administre).
3. Como `deploy`: crear `/opt/pos/.env` a partir de `.env.example` con valores reales,
   `DEPLOY_ENV=production`, `SITE_ADDRESS=tu-dominio`, y opcionalmente
   `COMPOSE_PROFILES=worker,scraper,monitoring`.
4. Configurar el remoto de respaldos: `rclone config` → remoto `backups` tipo S3 (Cloudflare R2 o DO Spaces).
5. Cargar los secretos del environment en GitHub y lanzar *Deploy* (manual o con push/tag).
6. Agregar los cron de respaldo y de disco (abajo) y los monitores de Uptime Kuma.

### Conectar un entorno nuevo

1. VPS con `provision.sh`, registro DNS y `/opt/pos/.env` propio (claves nuevas, nunca copiadas de otro entorno).
2. En GitHub: Settings → Environments → nuevo environment con los secretos de la tabla de arriba.
3. Agregarlo a las opciones de `workflow_dispatch` en `.github/workflows/deploy.yml` y lanzar el deploy manual.

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
  `migrate-mongo`) antes de reemplazar la API, espera `/api/v1/health` y deja escrito cómo volver atrás.

**Rollback:** `ssh deploy@host 'bash /opt/pos/scripts/deploy.sh <tag-anterior>'`.

### Ramas (S1)

`main` (producción, tags `v*`), `develop` (staging) y `feature/*`. Reglas, Conventional Commits
y dueños por carpeta en [`CONTRIBUTING.md`](../CONTRIBUTING.md) y [`.github/CODEOWNERS`](../.github/CODEOWNERS).
Activar en GitHub (Settings → Branches) la protección de `main` y `develop`: PR obligatorio,
1 revisión de CODEOWNERS y los checks de CI requeridos.

## Rotar secretos (S10)

| Secreto | Cómo rotarlo |
|---|---|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Cambiar en `/opt/pos/.env` y `docker compose -f docker-compose.prod.yml up -d api worker`. Cierra todas las sesiones. |
| `INGEST_API_KEY` | Cambiar en `.env` y reiniciar `api` y `scraper` a la vez (comparten el valor). |
| `APP_DB_PASSWORD` / `SCRAPER_DB_PASSWORD` | `mongosh` como root: `db.getSiblingDB("pos").changeUserPassword("pos_api", "<nueva>")`; luego actualizar `.env` y reiniciar. |
| `MONGO_ROOT_PASSWORD` | `db.getSiblingDB("admin").changeUserPassword("root", "<nueva>")` y actualizar `.env`. |
| `SSH_PRIVATE_KEY` (CI) | Generar llave nueva, agregar la pública a `~deploy/.ssh/authorized_keys`, actualizar el secreto y borrar la vieja. |
| `GHCR_READ_TOKEN` | Nuevo PAT con `read:packages`, actualizar el secreto del environment. |
| Pagos, S3, Sentry | Generar en el panel del proveedor, actualizar `.env`, reiniciar `api` y `worker`, revocar la anterior. |

Las variables `MONGO_INITDB_*` y `APP_DB_*` solo se aplican al crear el volumen; después
de esa primera vez, cambiar `.env` no cambia la contraseña en Mongo (por eso el `changeUserPassword`).

## Respaldos (S8)

`scripts/backup.sh` hace `mongodump --oplog` de toda la instancia a un `.archive.gz`,
lo sube a `backups:$BACKUP_BUCKET/<entorno>/` y borra lo que tenga más de 14 días.

```cron
15 3 * * * /opt/pos/scripts/backup.sh >> /opt/pos/backups/backup.log 2>&1
```

Prueba de restauración mensual: `scripts/restore-test.sh` restaura el último respaldo en un
contenedor temporal y lista documentos por colección. Restauración real:
`docker compose -f docker-compose.prod.yml exec -T mongo mongorestore --archive --gzip --drop --oplogReplay -u root -p ... --authenticationDatabase admin < archivo.archive.gz`.

MongoDB vive en nuestro VPS, así que infra corre estos respaldos; el equipo de DB revisa
que la restauración sea correcta y define índices y modelo. Acceso del equipo de DB:
`ssh -L 27017:127.0.0.1:27017 deploy@servidor` y conectar con `directConnection=true`.

Las imágenes de productos viven en el bucket S3 (R2/Spaces), con versionado activado en el bucket.

## Monitoreo y logs (S9)

- **Sentry:** `SENTRY_DSN` para api y worker, `SCRAPER_SENTRY_DSN` para el scraper. El backend inicializa
  `@sentry/node` si la variable existe; `SENTRY_ENVIRONMENT` toma `DEPLOY_ENV`.
- **Uptime Kuma:** `ssh -L 3002:localhost:3002 deploy@host` y abrir http://localhost:3002.
  Monitores: `https://tu-dominio/api/v1/health` cada 60 s y el dominio raíz. Alertas a correo o Telegram.
- **Disco:** monitor tipo *Push* en Uptime Kuma, su URL en `DISK_PUSH_URL` y cron
  `*/5 * * * * /opt/pos/scripts/disk-check.sh`. Si el disco pasa de 80 % deja de llegar el ping y Kuma alerta.
- **Logs:** todos los contenedores usan `json-file` con rotación (10 MB × 5). Ver con
  `docker compose -f docker-compose.prod.yml logs -f api`. Caddy y la API escriben JSON (pino).

## Contrato con los otros equipos

El scraping/limpieza de datos y el frontend los desarrollan otros equipos en sus carpetas.
Infra solo deja preparada la integración: Dockerfile o imagen, servicio en compose,
variables y jobs de CI que se activan solos cuando aparece `scraper/requirements.txt`
o `frontend/package.json`. Mientras tanto, `web` no se construye y `scraper` queda en su perfil.

- **Backend:** escucha en `PORT=3001`, expone `GET /api/v1/health` (200 si Mongo y Redis responden),
  lee `MONGO_URI` y `REDIS_URL`, define `npm run migrate` (índices) y `src/worker.js` para BullMQ.
  Las rutas internas viven bajo `/internal/v1/*` y exigen `INGEST_API_KEY`.
- **Scraper:** `scraper/requirements.txt`, módulo ejecutable `python -m scraper`, tests con pytest.
  Publica a `INGEST_URL` con `Idempotency-Key`; su base propia es `scraping`.
- **Frontend:** `npm run build` genera `frontend/dist`; las llamadas van a rutas relativas `/api/v1/...`
  (variable `VITE_API_URL`, por defecto `/api`).
