# Backend

API REST del POS de celulares: Node.js 22, Express 4, Mongoose 8 (MongoDB 8), Redis + BullMQ.

## Correr sin Docker

```bash
cd backend
npm install
cp ../.env.example .env   # cambia MONGO_URI a localhost (mongodb://localhost:27017/crm_celulares?replicaSet=rs0)
npm run dev               # API en http://localhost:3001
npm run worker            # en otra terminal, si necesitas colas
npm test                  # MongoDB en memoria (replica set); descarga mongod la primera vez
```

La forma recomendada es levantar solo Mongo y Redis con Docker y correr la API local:

```bash
docker compose -f ../infra/docker-compose.yml --env-file ../.env up -d mongo mongo-init redis
```

## Estructura

```
src/
  app.js            Express: middlewares y montaje de módulos
  server.js         conexión a Mongo + listen
  config/           env, database (Mongoose), redis
  middleware/       auth (JWT), authorize (roles), serviceToken (/internal), errores
  utils/            AppError, logger (pino), paginación
  modules/<modulo>/ routes, controller, service, validators, *.model.js
  jobs/             worker de BullMQ y sus jobs
tests/              Jest + Supertest + mongodb-memory-server
```

## Lo que ya funciona

- `GET /api/v1/health`
- `POST /internal/v1/ingest/batches` y `GET /internal/v1/ingest/batches/:id`: reciben y validan lotes del scraper
  contra `docs/contracts/ingest-batch.schema.json`, con `Idempotency-Key`. El procesamiento es la tarea B12.

## Reglas

- Transacciones de MongoDB (`session.withTransaction`) en todo lo que mueva stock o dinero: checkout, pagos, cancelaciones y devoluciones.
- Montos con `Schema.Types.Decimal128` en Mongo; en JSON se envían como texto (`"18999.00"`).
- Cada endpoint nuevo se agrega primero a `docs/openapi.yaml`.
- Código reutilizable de [mochi-matcha-react](https://github.com/MauriGGH/mochi-matcha-react/tree/main/backend/src): `utils/promociones.js`,
  `controllers/paypal.controller.js`, `utils/auditoria.js`, reportes con `exceljs`/`pdfkit`. Portar quitando Sequelize.
