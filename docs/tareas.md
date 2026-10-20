# Tareas detalladas: Backend y Servidor (MongoDB)

Repo de integración: https://github.com/MauriGGH/CRM_Celulares
Documento de arquitectura: https://claude.ai/artifact/PuNMNtRLKqa69QC2MptoV5
Código de referencia: https://github.com/MauriGGH/mochi-matcha-react (backend Express; le falta `backend/src/models/`)

**Alcance de este proyecto:** solo **backend** y **servidor**. Base de datos, scraping/limpieza y frontend los desarrollan otros equipos; aquí solo se preparan los puntos de integración con ellos (sección final). MongoDB corre en **nuestro VPS** (lo instala y opera el equipo de servidor).

**Negocio:** tienda **solo en línea**, **solo México** (MXN, PayPal y Mercado Pago). No hay venta en mostrador.

**Stack:** Node.js 22 + Express 4 + Mongoose 8 contra **MongoDB** (replica set, necesario para transacciones) + Redis 7 + BullMQ. Docker Compose + Caddy en un VPS Ubuntu 24.04, CI/CD con GitHub Actions.

**Fases:** F1 = base para que todos puedan integrarse (semana 1). F2 = flujo de venta completo. F3 = operación, reportes e integración con scraping.

---

## Backend

### B1. Contrato OpenAPI (F1)
- Completar `docs/openapi.yaml` con request y response de cada endpoint: auth, catálogo, carrito, checkout, pagos, pedidos, POS, admin e ingesta.
- Definir códigos de error estables (`STOCK_INSUFICIENTE`, `CUPON_INVALIDO`, `PEDIDO_NO_PAGABLE`, etc.).
- Servir la documentación en `GET /api/v1/docs` con swagger-ui-express.
- **Entregable:** PR aprobado por el equipo de frontend. **Criterio:** ningún endpoint se implementa sin estar antes en el YAML.
- **Depende de:** nada. **Desbloquea:** frontend.

### B2. Base del proyecto (F1)
- Express con helmet, cors, pino-http y respuesta de error estándar `{ error: { code, message, details } }`.
- Conexión con Mongoose leyendo `MONGO_URI`; `GET /api/v1/health` reporta Mongo y Redis.
- Utilidades: `AppError`, paginación (`page`, `limit` ≤ 100), helper `withTransaction(fn)`.
- ESLint, Jest, Supertest y mongodb-memory-server configurados.
- **Criterio:** `npm test` y `npm run lint` pasan en CI. **Depende de:** S2.

### B3. Esquemas Mongoose sobre el modelo del equipo de DB (F1)
- Con el modelo de datos que define el equipo de DB (propuesta inicial en `docs/data-model.md`), escribir los esquemas Mongoose en `src/modules/<modulo>/*.model.js`: `users`, `brands`, `categories`, `products` (variantes embebidas con `sku`, `color`, `almacenamiento_gb`, `ram_gb`, `precio`, `costo`, `gtin`, `match_key`), `warehouses`, `stock_levels`, `serial_units`, `stock_movements`, `carts`, `orders`, `payments`, `returns`, `promotions`, `audit_logs`, `settings`, `ingest_batches`, `ingest_records`, `competitor_prices`.
- Montos en `Decimal128`, enviados en JSON como texto (`"18999.00"`).
- Validar con el equipo de DB los índices únicos que el backend necesita: `users.email`, `products.slug`, `products.variants.sku`, `serial_units.imei`, `stock_levels (sku, warehouse_id)`, `orders.folio`.
- `src/seed.js` con datos de prueba para desarrollo local: 6 marcas, 3 categorías, 2 almacenes, 20 teléfonos con variantes, stock, IMEI y un usuario por rol.
- **Criterio:** `npm run seed` deja una base local usable. **Depende de:** acuerdo del modelo con el equipo de DB.

### B4. Estructura modular y limpieza del código heredado (F1)
- Un módulo por carpeta en `src/modules/` (`auth`, `users`, `catalog`, `inventory`, `cart`, `orders`, `payments`, `promotions`, `reports`, `audit`, `settings`, `ingest`) con `routes`, `controller`, `service`, `validators`, `model`.
- Regla: un módulo solo toca sus colecciones; para datos de otro usa su `service`.
- Al portar de mochi-matcha, descartar mesas, QR, sesión de mesa con PIN, cocina, alertas de mesero y horarios.

### B5. Autenticación y usuarios (F1)
- Portar `auth.js` y `authorize.js` de mochi-matcha con roles `admin`, `gerente`, `almacen`, `cliente`.
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`.
- Token de acceso de 15 min para clientes y 8 h para staff; refresh token en cookie `httpOnly`, `secure`, `sameSite=strict`, guardado con hash para poder revocarlo.
- CRUD de empleados en `/admin/users` (gerente y admin) y direcciones del cliente en `/me/addresses`.
- Rate limit de login en Redis: 5 intentos por minuto por IP.
- **Criterio:** tests de login correcto, contraseña errónea, token vencido y rol sin permiso (403).

### B6. Catálogo (F2)
- Público: `GET /products` con filtros `q`, `brand`, `category`, `min_price`, `max_price`, `storage_gb`, `condition`, `sort` y paginación; `GET /products/:slug`, `GET /brands`, `GET /categories`. Solo productos `publicado`.
- Disponibilidad por variante calculada desde `stock_levels`.
- Admin: CRUD de productos, variantes, marcas y categorías; estados `borrador`, `publicado`, `archivado`.
- `POST /admin/uploads`: imágenes a almacenamiento S3, solo jpg/png/webp de hasta 5 MB.
- Cada cambio de precio queda en `audit_logs`.
- **Criterio:** tests de búsqueda por texto con filtros combinados y paginación.

### B7. Inventario e IMEI (F2)
- `POST /admin/stock/movements` para `entrada`, `ajuste` y `traspaso`, siempre en transacción y con registro en `stock_movements`.
- `POST /admin/serials`: alta de IMEI en lote, validando 15 dígitos y algoritmo de Luhn. `GET /admin/serials/:imei` con historial.
- `GET /admin/stock` con alertas de stock bajo (umbral en `settings`).
- **Criterio:** un traspaso nunca deja stock negativo; un IMEI duplicado responde 409.

### B8. Carrito, promociones y checkout (F2)
- `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:sku`, `DELETE /cart/items/:sku`, `POST /cart/coupon`.
- Portar el motor `utils/promociones.js` de mochi-matcha (5 tipos de descuento, máximo una promo por pedido) quitando Sequelize.
- `POST /checkout` con `Idempotency-Key`: en una transacción crea el pedido `pendiente_pago`, copia precios y dirección, aumenta `reservado` en `stock_levels` y fija `reservado_hasta` a 15 min.
- Job `reservations` en BullMQ: al vencer la reserva cancela el pedido y libera el stock.
- **Criterio:** test de concurrencia con dos checkouts por la última unidad: solo uno gana, el otro recibe 409 `STOCK_INSUFICIENTE`.

### B9. Pagos (F2)
- Módulo `payments` con interfaz común (`createPayment`, `capturePayment`, `handleWebhook`) y proveedores `paypal` (portar `paypal.controller.js`) y `mercadopago`.
- `POST /payments/:provider/create`, `POST /payments/:provider/capture`, `POST /webhooks/:provider` con verificación de firma.
- Al confirmar el pago, en transacción: pedido a `pagado`, stock reservado pasa a vendido y movimiento `venta`. El IMEI se asigna al preparar el envío (B10).
- Idempotencia por `(proveedor, referencia_externa)`.
- **Criterio:** tests con respuestas simuladas de ambos proveedores, incluido un webhook duplicado que no descuenta dos veces.

### B10. Pedidos, envíos y devoluciones (F2)
- Cliente: `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel`, `POST /orders/:id/returns`.
- Admin: `GET /admin/orders` con filtros, `PATCH /admin/orders/:id/status` validando transiciones, `POST /admin/orders/:id/shipment`, `PATCH /admin/returns/:id`.
- Al pasar a `preparando`, el almacén escanea el IMEI de cada equipo y se asigna al pedido; comprobante del pedido en PDF (`GET /orders/:id/receipt`, pdfkit como mochi-matcha).
- Correos de confirmación de pedido y envío con la cola `emails`.
- **Criterio:** una transición inválida (por ejemplo `entregado → pagado`) responde 409.

### B11. Reportes, auditoría y configuración (F3)
- Agregaciones: ventas por día y marca; más vendidos; inventario valorizado; margen por SKU.
- `POST /admin/reports/export` en xlsx (exceljs) y pdf (pdfkit), portados de mochi-matcha.
- `GET /admin/audit` con filtros; `GET` y `PUT /admin/settings`.

### B12. Integración con scraping (F3)
- Ya existe la recepción en el scaffold: `POST /internal/v1/ingest/batches` valida contra `docs/contracts/ingest-batch.schema.json` y guarda el lote con `Idempotency-Key`.
- Encolar el lote y procesarlo en el worker: empatar por `gtin` y luego por `match_key`; si coincide, guardar en `competitor_prices`; si no, crear `ingest_records` como `nuevo` o `conflicto`.
- Panel: `GET /admin/ingest/records`, `POST .../:id/approve` (crea producto en `borrador`), `POST .../:id/reject`, `GET /admin/competitor-prices?sku=`.
- **Regla:** la ingesta nunca cambia precios de venta ni publica productos sola.
- **Criterio:** con el lote de ejemplo, un registro coincide y otro queda como `nuevo`.

### B13. Seguridad y observabilidad (F3)
- Rate limit en Redis para endpoints sensibles; validación de entrada con express-validator en todos los endpoints.
- Sentry en API y worker; logs sin contraseñas, tokens ni datos de tarjeta.

### B14. Pruebas (continuo)
- Tests por módulo con Jest + Supertest sobre mongodb-memory-server en modo replica set.
- Cobertura mínima de 70% en los `services` de checkout, pagos e inventario.

---

## Servidor / infra

### S1. Repositorio y flujo de trabajo (F1)
- Monorepo con `backend/`, `infra/`, `docs/`; carpetas `frontend/` y `scraper/` reservadas para los otros equipos.
- Ramas `main` (producción), `develop` (staging), `feature/*`; protección de ramas con PR, 1 revisión y CI en verde.
- `CONTRIBUTING.md` con Conventional Commits y `CODEOWNERS` por carpeta.

### S2. Entorno local con Docker Compose (F1)
- `infra/docker-compose.yml` con `mongo:8.0` (replica set `rs0` de un nodo) y `mongo-init`, `redis:7`, `api`, `worker` y `caddy`.
- `.env.example` en la raíz con todas las variables.
- **Criterio:** `docker compose up` en una máquina limpia deja `http://localhost/api/v1/health` en 200.

### S3. Imágenes Docker (F1)
- `backend/Dockerfile` multi-etapa con Node 22 alpine, dependencias de producción, usuario no root y `HEALTHCHECK`.
- La misma imagen corre `api` y `worker` con distinto comando.

### S4. MongoDB en el VPS (F1)
- Mongo 8 en contenedor con replica set `rs0` de un nodo (necesario para transacciones), `--auth` y `keyFile` generado en el servidor (permisos 400).
- Usuarios: `root` solo para administración; `crm_api` con `readWrite` en `crm_celulares`; un usuario para el equipo de DB con los roles que acuerden; y, si el scraping lo necesita, uno con acceso solo a su propia base.
- Sin puerto público: solo red interna de Docker. Acceso del equipo de DB por túnel SSH.
- Volumen persistente y `wiredTigerCacheSizeGB` acotado para no agotar la RAM del VPS.
- **Criterio:** la API ejecuta una transacción de prueba en staging.

### S5. Servidor VPS (F2)
- Ubuntu 24.04 LTS, 2 vCPU y 4 GB de RAM para empezar (estimado, ajustar con tráfico real).
- Usuario sin root, SSH solo con llave, `ufw` con 22/80/443, `fail2ban`, actualizaciones automáticas de seguridad, Docker.
- Script de aprovisionamiento en `infra/scripts/provision.sh`.

### S6. Caddy y dominio (F2)
- `infra/caddy/Caddyfile`: HTTPS automático, `/api/*` hacia `api:3001`, el resto al build del frontend, `/internal/*` bloqueado desde Internet, cabeceras de seguridad y compresión.
- `staging.<dominio>` y `<dominio>`.

### S7. CI/CD con GitHub Actions (F2)
- `ci.yml`: lint y tests del backend en cada PR.
- `deploy.yml`: merge a `develop` construye la imagen, la sube a GitHub Container Registry y despliega a staging por SSH; un tag `v*` en `main` despliega a producción.
- Secretos en GitHub Environments `staging` y `production`.

### S8. Almacenamiento y respaldos (F2)
- Bucket S3 compatible (Cloudflare R2 o DigitalOcean Spaces) para imágenes de productos y respaldos.
- `mongodump --archive --gzip` diario a S3 con 14 días de retención; prueba de restauración documentada y repetida cada mes.

### S9. Monitoreo y logs (F3)
- Uptime Kuma contra `/api/v1/health` con alertas; Sentry para API y worker; rotación de logs de Docker; alerta de disco > 80%.

### S10. Operación (F3)
- `infra/README.md`: desplegar, revertir a la versión anterior, rotar secretos y conectar un nuevo entorno.

---

## Puntos de integración con los otros equipos

| Equipo | Qué le entregamos | Dónde | Qué nos entrega |
| --- | --- | --- | --- |
| Base de datos | MongoDB 8 corriendo en nuestro VPS (replica set, usuarios, respaldos) y las colecciones e índices que necesita el backend | `docs/data-model.md`, túnel SSH | Validación del modelo, índices y consultas |
| Scraping y limpieza | Contrato del lote, token de servicio, URL interna de ingesta | `docs/contracts/ingest-batch.schema.json` + ejemplo | Lotes limpios en `POST /internal/v1/ingest/batches` con `Idempotency-Key` |
| Frontend | Contrato de la API, URL de staging, usuarios de prueba por rol | `docs/openapi.yaml`, `GET /api/v1/docs` | Build estático que sirve Caddy |

Cualquier cambio a un contrato se hace por PR y lo aprueban ambos equipos.

## Preguntas abiertas
- ¿El equipo de DB define el modelo y los índices, o solo opera el servidor de MongoDB? Si solo lo opera, B3 incluye diseñar el modelo.
- Resuelto: MongoDB vive en nuestro VPS; la tienda es solo en línea y solo México.
