# CRM Celulares

Punto de venta online de celulares. Monorepo con cuatro partes que se integran aquí:

| Carpeta | Equipo | Stack |
| --- | --- | --- |
| [`backend/`](backend/) | Backend (este proyecto) | Node.js 22, Express 4, Mongoose 8, Redis + BullMQ |
| [`infra/`](infra/) | Servidor (este proyecto) | Docker Compose, Redis 7, Caddy, GitHub Actions |
| [`docs/`](docs/) | Todos | Contratos: OpenAPI, esquema de ingesta y modelo de datos |
| [`frontend/`](frontend/) | Otro equipo | Reservada; solo guía de integración |
| [`scraper/`](scraper/) | Otro equipo (scraping y limpieza) | Reservada; solo guía de integración |

MongoDB corre en nuestro VPS como contenedor (lo opera el equipo de servidor); el equipo de base de datos valida el modelo e índices.

Documento de arquitectura: https://claude.ai/artifact/PuNMNtRLKqa69QC2MptoV5

## Arquitectura en una línea

El frontend habla solo con la API (`/api/v1`). El servicio de scraping entrega lotes limpios a la API por
`POST /internal/v1/ingest/batches` y **nunca escribe en la base de ventas**.

```
Navegador ──► Caddy ──► api (Express) ──► MongoDB 8 (replica set)
                           ▲     │
              lotes limpios│     ▼
         servicio de scraping   Redis/BullMQ ◄── worker
```

## Arranque rápido (local)

Requisitos: Docker y Docker Compose.

```bash
cp .env.example .env          # ajusta contraseñas
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
curl -k https://localhost/api/v1/health
```

Cada carpeta tiene su propio README con cómo trabajar sin Docker.

## Contratos (fuente de verdad)

- [`docs/openapi.yaml`](docs/openapi.yaml): API REST que consume el frontend. Ningún endpoint se mezcla sin estar aquí.
- [`docs/contracts/ingest-batch.schema.json`](docs/contracts/ingest-batch.schema.json): lote que el scraper envía al backend.
- [`docs/tareas.md`](docs/tareas.md): reparto, recursos y tareas de Backend (B1–B14) y Servidor (S1–S11).
- [`docs/data-model.md`](docs/data-model.md): colecciones de MongoDB que necesita el backend (a acordar con el equipo de DB).

Cambiar un contrato requiere PR con revisión de los equipos afectados.

## Cómo colaborar

Ver [CONTRIBUTING.md](CONTRIBUTING.md): ramas, commits, PRs y dueños de cada carpeta.
