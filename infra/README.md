# Infraestructura

Dueño: equipo de servidor. Producción corre con Docker Compose en una **Raspberry Pi 4 (arm64)**.
El tráfico entra por **Cloudflare Tunnel**: la Pi abre una conexión saliente hacia Cloudflare,
así que no se abren puertos en el router y Cloudflare pone el HTTPS. CI/CD con GitHub Actions
y un runner instalado en la propia Pi.

```
cliente ──HTTPS──▶ Cloudflare ══túnel══▶ cloudflared ──▶ caddy :80 ──/api/*──▶ api :3001 ──▶ mongo (rs0) / redis
                                                            └── resto ──▶ frontend/dist      worker ──┘
scraper (otro equipo) ──▶ http://api:3001/internal/v1/ingest/batches   (solo red interna; Caddy da 403)
```

## Servicios

| Servicio | Imagen | Expuesto | Notas |
| --- | --- | --- | --- |
| `cloudflared` | cloudflare/cloudflared | Nada (conexión saliente) | Solo en prod; usa `TUNNEL_TOKEN` |
| `caddy` | caddy:2-alpine | Local: 80/443. Pi: 127.0.0.1:8080 | `/api/*` → api, resto → `frontend/dist`, `/internal/*` → 403 |
| `api` | `ghcr.io/mauriggh/crm-celulares-backend` (arm64 + amd64) | No | `GET /api/v1/health` |
| `worker` | misma imagen que api | No | Colas BullMQ |
| `redis` | redis:7-alpine | No | Colas, caché, rate limit |
| `mongo` + `mongo-init` | Local: mongo:8.0. Pi 4: mongo:4.4.18 (`MONGO_IMAGE`) | 127.0.0.1:27017 | Replica set `rs0`. En la Pi con `--auth`, keyFile y usuario `crm_api` |
| `uptime-kuma` | louislam/uptime-kuma:1 | 127.0.0.1:3002 | Perfil `monitoring` |

## Local

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
curl -k https://localhost/api/v1/health
```

Si no existe `frontend/dist`, Caddy responde 404 en `/`; la API funciona igual.

## Requisitos de la Raspberry Pi

- **Raspberry Pi 4 de 4 u 8 GB** (con 2 GB no alcanza para Mongo, API, worker y Redis juntos).
- **SSD por USB 3** (puerto azul). MongoDB sobre microSD se degrada y la desgasta. Lo ideal es arrancar el
  sistema desde el SSD; si no, montarlo en `/srv` y pasar `DOCKER_DATA_ROOT=/srv/docker` a `provision.sh`.
- Raspberry Pi OS Lite **64 bits** (Bookworm) o Ubuntu Server 24.04 arm64.
- Fuente oficial de 15 W, disipador o ventilador, cable Ethernet, IP fija por reserva DHCP y, de preferencia, un UPS pequeño.

### MongoDB en la Pi 4

MongoDB 5 o superior exige ARMv8.2-A y la Pi 4 (Cortex-A72, ARMv8.0) no lo tiene. Por eso en la Pi se usa
**`MONGO_IMAGE=mongo:4.4.18`**, la última versión que arranca ahí.

- Funciona igual en lo importante: replica set `rs0`, transacciones, Mongoose 8, índices y `mongodump`.
- No hay colecciones *time series* (5.0+): `competitor_prices` va como colección normal con índice por fecha.
  Tampoco hay `$setWindowFields` ni otras funciones de agregación de 5.0 en adelante. **Backend debe probar contra 4.4**
  (en CI con `mongodb-memory-server` fijando `binary.version: '4.4.18'`).
- **Riesgo:** 4.4 dejó de recibir parches de seguridad en febrero de 2024. Se mitiga porque Mongo nunca se expone:
  solo escucha en la red interna de Docker y en 127.0.0.1 de la Pi, con `--auth` y keyFile, más respaldos diarios.
- Salida: con una Pi 5 se cambia `MONGO_IMAGE=mongo:8.0`. Antes, restaurar el respaldo de 4.4 en un Mongo 5, luego en 6, 7 y 8
  (MongoDB solo sube de versión mayor en versión mayor), o hacer `mongodump`/`mongorestore` directo, que también funciona.
- Los compose usan `mongosh` o `mongo` según el que traiga la imagen, así que sirven para ambas versiones.
- `MONGO_CACHE_GB=0.5` y `MONGO_MEM_LIMIT=1500m` en una Pi de 4 GB. Con 8 GB, `1` y `2g`.

## Despliegue rápido en la Pi de pruebas (git pull)

La Pi actual (Pi 4 de 4 GB con SSD) es **temporal y solo para pruebas**. Se entra por SSH con Tailscale y el repo ya
está clonado en `~/pi/docker/CRM_Celulares`, así que no hace falta el runner ni `provision.sh`.

1. **Túnel** en Cloudflare Zero Trust → Networks → Tunnels → *Create a tunnel* (Cloudflared). Copiar el token.
   *Public hostname*: `<sub>.coliredes-paloalto.uk` → `http://caddy:80` (y, si se usa, `ingest.coliredes-paloalto.uk` → `http://caddy:80`).
2. En la Pi, una sola vez:
   ```bash
   cd ~/pi/docker/CRM_Celulares
   cp .env.example .env && nano .env
   ```
   Cambiar como mínimo: `TUNNEL_TOKEN`, `MONGO_ROOT_PASSWORD`, `MONGO_APP_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`,
   `INGEST_SERVICE_TOKEN`, `NODE_ENV=production`, `CORS_ORIGIN=https://<sub>.coliredes-paloalto.uk` y
   `MONGO_URI=mongodb://crm_api:<MONGO_APP_PASSWORD>@mongo:27017/crm_celulares?replicaSet=rs0&authSource=crm_celulares`.
   Los valores por defecto de memoria ya son para 4 GB con `mongo:4.4.18`.
3. Cada vez que haya cambios:
   ```bash
   bash infra/scripts/pi-deploy.sh            # git pull + build en la Pi + espera /api/v1/health
   ```
   La primera vez crea `infra/secrets/mongo-keyfile` (pide `sudo`). Construir la imagen en la Pi 4 toma unos minutos.
4. Probar desde la Pi: `curl http://127.0.0.1:8080/api/v1/health`. Desde fuera: `https://<sub>.coliredes-paloalto.uk/api/v1/health`.
5. Ver logs: `docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env logs -f api`.

Catálogo de modelos del equipo de DB (100 teléfonos de GSMArena en `infra/mongo/seed/modelos.json`):
`bash infra/scripts/import-modelos.sh prod` los carga en `crm_celulares.modelos` (upsert por `id`, se puede repetir).
No usar el `docker-compose.yml` que trae el zip del equipo de DB en la Pi: usa `mongo:latest` (no arranca en la Pi 4),
no es replica set (sin transacciones), publica 27017 y mongo-express (8081) a toda la red con `admin/password123`.

Respaldo opcional: `APP_DIR=$PWD bash infra/scripts/backup.sh` deja el dump en `backups/`.

Lo que sigue en este documento (runner, staging, `provision.sh`, cron, Access y WAF) es para cuando haya un servidor definitivo.

## Puesta en marcha (una sola vez)

1. **Sistema:** grabar el SO en el SSD, habilitar SSH con tu llave y arrancar.
2. **Runner de GitHub:** en GitHub, Settings → Actions → Runners → *New self-hosted runner* (Linux, ARM64) y copiar el token.
3. **Aprovisionar** (como root en la Pi):
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/MauriGGH/CRM_Celulares/main/infra/scripts/provision.sh
   DEPLOY_PUBKEY="ssh-ed25519 AAAA... tu-laptop" RUNNER_TOKEN=<token> LAN_CIDR=192.168.1.0/24 \
     APP_DIRS="/opt/crm /opt/crm-staging" bash provision.sh
   ```
   Deja el usuario `deploy`, SSH solo con llave, firewall que solo permite SSH, Docker, fail2ban,
   actualizaciones automáticas, rclone, `/opt/crm` (y `/opt/crm-staging`) con su keyFile de Mongo
   y el runner como servicio con la etiqueta `crm-pi`.
4. **Túnel en Cloudflare** (panel Zero Trust → Networks → Tunnels → *Create a tunnel* → Cloudflared):
   - Nombre `crm-prod`. Copiar el token, que va en `TUNNEL_TOKEN`. No se instala nada en la Pi, porque `cloudflared` corre como contenedor.
   - *Public hostnames* del túnel `crm-prod`:
     - `<dominio>` y `www.<dominio>` → `http://caddy:80`
     - `ingest.<dominio>` → `http://caddy:80` (Caddy solo deja pasar `/internal/v1/ingest/*` en este host; poner `INGEST_HOST=ingest.<dominio>`)
     - `ssh.<dominio>` → `ssh://<IP-LAN-de-la-Pi>:22` (p. ej. `ssh://192.168.1.50:22`)
   - Staging: un segundo túnel `crm-staging` con `staging.<dominio>` → `http://caddy:80` y su propio token,
     porque cada stack tiene su `cloudflared`.
   - **Access** (Zero Trust → Access → Applications):
     - `ssh.<dominio>`: política *Allow* solo a los correos del equipo (login por correo con código). Desde la laptop:
       `cloudflared access ssh --hostname ssh.<dominio>` en `~/.ssh/config` como `ProxyCommand`.
     - `ingest.<dominio>`: política *Service Auth* con un Service Token para el equipo de scraping, que manda
       `CF-Access-Client-Id` y `CF-Access-Client-Secret` además de su `Bearer`.
     - `staging.<dominio>`: opcional, solo correos del equipo.
   - SSL/TLS en modo *Full*, *Always Use HTTPS* activado.
   - **WAF** (Security → WAF → Custom rules): bloquear `starts_with(http.request.uri.path, "/internal")` cuando
     `http.host ne "ingest.<dominio>"`. Es una segunda barrera además de la de Caddy.
5. **`.env` de cada entorno** en `/opt/crm/.env` y `/opt/crm-staging/.env` (chmod 600), a partir de `.env.example`:
   - Secretos nuevos y distintos por entorno: `MONGO_*`, `JWT_*`, `INGEST_SERVICE_TOKEN`, `TUNNEL_TOKEN`.
   - `MONGO_URI=mongodb://crm_api:<MONGO_APP_PASSWORD>@mongo:27017/crm_celulares?replicaSet=rs0&authSource=crm_celulares`
   - `CORS_ORIGIN=https://tienda.<dominio>`, `NODE_ENV=production`, `DEPLOY_ENV=production`.
   - Pi 4: `MONGO_IMAGE=mongo:4.4.18`, `MONGO_CACHE_GB=0.5`, `MONGO_MEM_LIMIT=1500m` (con 4 GB).
   - Staging: `COMPOSE_PROJECT_NAME=crm-staging`, `DEPLOY_ENV=staging`, `MONGO_DB_NAME=crm_celulares_staging`
     (y la misma base en `MONGO_URI`), `MONGO_LOCAL_PORT=27018`, `HTTP_LOCAL_PORT=8081`, `MONGO_CACHE_GB=0.25`, `MONGO_MEM_LIMIT=768m`.
6. **GitHub → Settings → Environments:** crear `production` y `staging`, cada uno con la variable
   `APP_DIR` (`/opt/crm` y `/opt/crm-staging`). En `production` activar *Required reviewers*.
7. **Primer deploy:** Actions → *Deploy* → *Run workflow* → `production`.
8. **Cron** del usuario `deploy` (`crontab -e`):
   ```cron
   15 3 * * * /opt/crm/infra/scripts/backup.sh >> /opt/crm/backups/backup.log 2>&1
   */5 * * * * /opt/crm/infra/scripts/health-check.sh >> /opt/crm/backups/health.log 2>&1
   ```

> Con una Pi 4 de 4 GB, prod y staging juntos van muy justos de memoria. Si `free -h` muestra swap
> constante, conviene dejar staging apagado (`docker compose -p crm-staging stop`) y encenderlo solo para probar.

## CI/CD (S2 y S8)

- `ci.yml` en cada PR (runners de GitHub): lint y tests del backend, build de la imagen,
  validación de ambos compose, del Caddyfile y de los scripts (shellcheck).
- `deploy.yml`:
  1. Construye la imagen para `linux/arm64` y `linux/amd64` y la sube a GHCR con tag `sha-xxxxxxx` o `v1.2.3`.
  2. Compila el frontend si ya existe `frontend/package.json`.
  3. En la Pi (runner `crm-pi`): copia `infra/` y `frontend/dist` a `APP_DIR` y ejecuta `deploy.sh <tag>`.
     Ese script baja la imagen, levanta mongo y redis, corre `npm run migrate --if-present`,
     reinicia todo y espera a que `/api/v1/health` responda.
- `push` a `develop` despliega a staging. Un tag `v*` despliega a producción, con aprobación.
- **Rollback:** `ssh deploy@pi 'APP_DIR=/opt/crm bash /opt/crm/infra/scripts/deploy.sh <tag-anterior>'`.

El runner de la Pi **nunca** corre código de PRs: solo `deploy.yml` lo usa y ese workflow no se dispara con
`pull_request`. Mantener el repo privado o, si es público, exigir aprobación para PRs de forks.

## Respaldos (S9)

`backup.sh` (cron diario a las 03:15) deja en `backups/` del SSD:
- `mongo-<entorno>-<fecha>.archive.gz`: `mongodump --oplog` de toda la instancia, que incluye usuarios.
- `media-<entorno>-<fecha>.tar.gz`: las imágenes de productos (volumen `media-data`).

Guarda 14 días en el SSD y, si hay `S3_*` en `.env`, los copia a Cloudflare R2 en `<bucket>/backups/<entorno>/` con la
misma retención. Si se pierde la Pi, la copia en R2 es lo único que queda, así que conviene configurarla.

- **Prueba rápida:** `infra/scripts/restore-test.sh` restaura el último respaldo en un Mongo temporal y cuenta documentos.
- **Prueba mensual en staging:**
  `APP_DIR=/opt/crm-staging SRC_DB_NAME=crm_celulares bash /opt/crm/infra/scripts/restore.sh /opt/crm/backups/<archivo>.archive.gz`
  (pide escribir `RESTAURAR` y renombra la base a `crm_celulares_staging`).
- **Restauración real en producción:** `APP_DIR=/opt/crm bash /opt/crm/infra/scripts/restore.sh backups/<archivo>.archive.gz`.
  Imágenes: `docker run --rm -v crm-celulares_media-data:/media -v $PWD/backups:/b alpine tar xzf /b/<media>.tar.gz -C /media`.

## Monitoreo y logs (S10)

- **Uptime Kuma:** `COMPOSE_PROFILES=monitoring` en `/opt/crm/.env`. Se entra con `ssh -L 3002:127.0.0.1:3002 deploy@pi`
  y abriendo http://localhost:3002. Agregar monitores de `https://tienda.<dominio>/api/v1/health` cada 60 s y alertas
  por Telegram o correo.
- **Monitor externo (obligatorio):** si la Pi se apaga, Kuma cae con ella. Crear en UptimeRobot (gratis) un monitor HTTP
  de `https://<dominio>/api/v1/health` cada 5 min y un monitor *Heartbeat/Push* cuya URL va en `HEALTH_PUSH_URL`.
- **Temperatura, disco y memoria:** `health-check.sh` (cron cada 5 min) hace ping a `HEALTH_PUSH_URL` solo si
  la temperatura está por debajo de 75 °C, el disco por debajo del 80 % y la memoria por debajo del 90 %. Si algo se pasa,
  deja de llegar el ping y el monitor alerta. El detalle queda en `backups/health.log`.
- **Sentry:** `SENTRY_DSN` para api y worker (lo integra backend).
- **Logs:** `json-file` con rotación de 10 MB × 5 por contenedor. Ver con `docker compose ... logs -f api`.
  La IP real del cliente llega en el encabezado `CF-Connecting-IP`.

## Rotar secretos (S11)

| Secreto | Cómo |
| --- | --- |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Cambiar en `.env` y `up -d api worker`. Cierra todas las sesiones. |
| `INGEST_SERVICE_TOKEN` | Cambiar en `.env`, reiniciar `api` y avisar al equipo de scraping. |
| `MONGO_APP_PASSWORD` | `mongosh` como root: `db.getSiblingDB("crm_celulares").changeUserPassword("crm_api", "<nueva>")`, luego `.env` (`MONGO_APP_PASSWORD` y `MONGO_URI`) y reiniciar api y worker. |
| `MONGO_ROOT_PASSWORD` | `db.getSiblingDB("admin").changeUserPassword("root", "<nueva>")` y actualizar `.env`. |
| `TUNNEL_TOKEN` | En Zero Trust, *Refresh token* del túnel, actualizar `.env` y `up -d cloudflared`. |
| Pagos, R2, Sentry | Generar una nueva en el proveedor, actualizar `.env`, reiniciar y revocar la anterior. |

`MONGO_INITDB_*` solo se aplica al crear el volumen. Después, cambiar `.env` no cambia la contraseña dentro de Mongo.

## API de exportación para sistemas externos

Backend expone `/external/v1/*` (tarea B15, autenticado con API key por cliente). Infra lo publica así:

- Hostname propio en el túnel: `api-crm.coliredes-paloalto.uk` → `http://caddy:80` (un solo nivel, sin certificado de pago), con `EXTERNAL_HOST=api-crm.coliredes-paloalto.uk`
  en `.env`. En ese host Caddy solo deja pasar `/external/*`; todo lo demás da 404. También responde en el host principal.
  Las respuestas van en streaming (`flush_interval -1`) para descargas grandes.
- **Rate limit en el borde** (Cloudflare → Security → WAF → *Rate limiting rules*; el plan gratis permite una regla):
  si `starts_with(http.request.uri.path, "/external/")`, 60 peticiones por minuto por IP, acción *Block* durante 1 minuto.
  El backend aplica además su propio límite por API key.

## Integración con otros equipos

- **Base de datos:** Mongo vive en la Pi. El equipo de DB entra por `ssh.<dominio>` (Cloudflare Access) con su llave y abre
  un túnel `-L 27017:127.0.0.1:27017`, con su propio usuario de Mongo (no `root`). Debe saber que la versión es **4.4**.
- **Scraping:** llama a `https://ingest.<dominio>/internal/v1/ingest/batches` con el Service Token de Cloudflare
  (`CF-Access-Client-Id`/`Secret`), `Authorization: Bearer <INGEST_SERVICE_TOKEN>` e `Idempotency-Key`.
- **Frontend:** `deploy.yml` compila `frontend/` cuando exista y Caddy sirve `frontend/dist`. En producción todo va por el mismo dominio, sin CORS.

## Si se va la luz o el internet

- Todos los servicios tienen `restart: unless-stopped` y Docker arranca con el sistema, así que al volver la luz la Pi levanta sola
  el stack completo (Mongo, Redis, API, worker, Caddy y el túnel). No hace falta entrar.
- Al volver internet, `cloudflared` se reconecta solo. Mientras tanto Cloudflare muestra un error 1033 o 530.
- Después de un corte: `docker compose -p crm-celulares ps` para confirmar que todo diga *healthy*, y revisar
  `backups/health.log`. Si Mongo no levanta por un apagado brusco, revisar `logs mongo`; en el peor caso,
  restaurar el último respaldo.
- Un UPS pequeño (de 30 a 60 min) evita la mayoría de los apagados bruscos, que son lo que daña SSD y microSD.
