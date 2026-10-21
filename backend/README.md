# Backend

API REST de la tienda en línea de celulares (México, MXN): Node.js 22, Express 4, Mongoose 8 sobre MongoDB 4.4 (Raspberry Pi 4) como replica set, Redis + BullMQ.

## Correr sin Docker

```bash
cd backend
npm install
cp ../.env.example .env   # cambia MONGO_URI a localhost (mongodb://localhost:27017/crm_celulares?replicaSet=rs0)
npm run dev               # API en http://localhost:3001
npm run worker            # en otra terminal, si necesitas colas
npm run migrate           # crea colecciones e índices (también lo corre el deploy)
npm run seed              # datos de prueba; contraseña de los usuarios: Cambiar123!
npm test                  # ver "Tests" abajo
```

La forma recomendada es levantar solo Mongo y Redis con Docker y correr la API local:

```bash
docker compose -f ../infra/docker-compose.yml --env-file ../.env up -d mongo mongo-init redis
```

## Tests

Jest + Supertest. Las transacciones requieren replica set, así que los tests usan `MONGO_URI_TEST` si existe
o, si no, `mongodb-memory-server` con MongoDB 4.4.18 (necesita libssl1.1, que Ubuntu 24.04 ya no trae). Lo más simple:

```bash
docker run -d --name mongo-test -p 27018:27017 mongo:4.4.18 --replSet rs0
docker exec mongo-test mongo --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
MONGO_URI_TEST="mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true" npm test
```

Cada archivo usa su propia base y la limpia entre tests. CI hace lo mismo con `mongo:4.4.18`.

## Estructura

```
src/
  app.js            Express: middlewares y montaje de módulos
  server.js         conexión a Mongo + listen
  config/           env, database (Mongoose), redis
  middleware/       auth (JWT), authorize (roles), validate, rateLimit, idempotency, serviceToken, errores
  utils/            money (centavos ↔ Decimal128), transaction, queue, promociones, storage, mailer, csv…
  modules/<modulo>/ routes, service, validators, *.model.js (ver modules/README.md)
  jobs/             handlers de las colas y worker de BullMQ
  scripts/migrate.js
  seed.js
tests/              Jest + Supertest
```

## Qué hay

Ver la tabla en [`src/modules/README.md`](src/modules/README.md). En resumen:

- Clientes: registro y login con refresh token en cookie, direcciones, catálogo con filtros, carrito con cupones y
  promociones, checkout que aparta stock 15 minutos, pago con Mercado Pago o PayPal, pedidos, cancelación y devoluciones.
- Panel (admin, gerente, almacén): productos con variantes e imágenes, fichas de la colección `modelos` → borrador,
  stock por almacén, alta de IMEI, pedidos con guía de envío, reportes con exportación a Excel o PDF, auditoría y ajustes.
- Integraciones: ingesta del scraper (`/internal/v1/ingest`) con empate contra el catálogo y cola de revisión, y API de
  solo lectura para sistemas externos (`/external/v1`) con llaves por cliente y exportaciones asíncronas.
- Colas: `reservations` (reservas vencidas y barrido cada minuto), `ingest`, `emails`, `exports`.
- Documentación interactiva en `/api/v1/docs`; contratos en `/api/v1/openapi.json` y `/external/v1/openapi.json`.

## Reglas

- Transacciones de MongoDB (`session.withTransaction`) en todo lo que mueva stock o dinero: checkout, pagos, cancelaciones y devoluciones.
- Montos con `Schema.Types.Decimal128` en Mongo; en JSON se envían como texto (`"18999.00"`).
- Cada endpoint nuevo se agrega primero a `docs/openapi.yaml`.
- Nada de funciones de MongoDB 5.0+ (producción corre 4.4.18): sin time series, sin `$lookup` con pipeline y `localField` a la vez,
  sin `$setWindowFields`. Las colecciones se crean fuera de las transacciones (`npm run migrate`).
- Origen: el motor de promociones, auditoría y reportes se portaron de [mochi-matcha-react](https://github.com/MauriGGH/mochi-matcha-react).
