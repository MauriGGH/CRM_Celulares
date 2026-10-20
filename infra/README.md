# Infraestructura

Dueño: equipo de servidor. Docker Compose + Caddy en un VPS Ubuntu 24.04; CI/CD con GitHub Actions.

## Servicios

| Servicio | Imagen | Expuesto | Notas |
| --- | --- | --- | --- |
| `caddy` | caddy:2-alpine | 80, 443 | HTTPS automático, `/api/*` → api, resto → `frontend/dist`, `/internal/*` bloqueado |
| `api` | `backend/Dockerfile` | No (red interna) | `GET /api/v1/health` |
| `worker` | misma imagen que api | No | Colas BullMQ |
| `redis` | redis:7-alpine | No | Colas, caché, rate limit |
| `mongo` + `mongo-init` | mongo:8.0 | Local: 127.0.0.1. VPS: no | Replica set `rs0`. En el VPS con `--auth`, keyFile y usuario `crm_api` creado por `mongo-init` |

## Local

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
curl -k https://localhost/api/v1/health
```

Si no existe `frontend/dist`, Caddy responde 404 en `/`; la API funciona igual.

## Staging y producción

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml --env-file .env up -d
```

El override activa autenticación y keyFile en Mongo (ver cabecera del archivo para generar `infra/secrets/mongo-keyfile`), usa imágenes de `ghcr.io/mauriggh/crm-celulares-backend` y limita los logs. Mongo no publica puertos; el equipo de DB entra por túnel SSH.
Requiere Docker Compose 2.24 o superior.

## Integración con otros equipos

- **Base de datos:** Mongo vive en este VPS. El equipo de DB accede con su propio usuario por túnel SSH (`ssh -L 27017:localhost:27017` hacia un puerto que solo escuche en 127.0.0.1).
- **Scraping:** si su servicio corre en este mismo host, entra a la red de Docker y llama a `http://api:3001/internal/v1/ingest/batches`.
  Si corre en otro servidor, publicar `/internal/*` en un subdominio aparte con lista de IPs permitidas, nunca abierto.
- **Frontend:** su build (`frontend/dist`) se copia o se construye en el deploy y Caddy lo sirve.

## Pendiente (ver lista de tareas S1–S10)

- `deploy.yml` (build, push a GHCR, deploy por SSH), `scripts/provision.sh` (incluye keyFile), `mongodump` diario a S3, monitoreo.
