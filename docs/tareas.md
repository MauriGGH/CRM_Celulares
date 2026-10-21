# Tareas de Backend y Servidor: reparto, recursos y detalle

Repo: https://github.com/MauriGGH/CRM_Celulares
Código de referencia: https://github.com/MauriGGH/mochi-matcha-react (backend Express)

**Decisiones vigentes:** tienda solo en línea y solo México (MXN, PayPal y Mercado Pago). Node.js 22 + Express 4 + Mongoose 8 + Redis 7 + BullMQ. MongoDB en replica set (transacciones). Servidor: **Raspberry Pi** en casa del responsable, publicada con **Cloudflare Tunnel** en el dominio de Cloudflare (sin abrir puertos del router). Base de datos, scraping y frontend son de otros equipos; aquí solo se preparan sus puntos de integración.

**Dominios (Cloudflare, un solo nivel bajo `coliredes-paloalto.uk` para que cubra el certificado gratuito):**

| Uso | Hostname |
| --- | --- |
| Tienda y API (`/api/v1`) | `crm-celulares.coliredes-paloalto.uk` |
| API para sistemas externos (`/external/v1`) | `api-crm.coliredes-paloalto.uk` |
| Ingesta del scraping (`/internal/v1/ingest`) | `ingest-crm.coliredes-paloalto.uk` (Cloudflare bloquea `/internal` en los demás hosts) |

La Pi es un **entorno de pruebas**: no hay staging aparte. El acceso administrativo a la Pi es por **Tailscale**, sin SSH público. En el resto del documento, `<dominio>` se refiere a estos hostnames; las menciones a `staging.<dominio>` o `ssh.<dominio>` aplican solo si más adelante hay un servidor definitivo. Plan de la zona: `/mnt/project-files/cloudflare/plan-zona.md`.

**Fases:** F1 = base para que todos puedan trabajar (semana 1). F2 = flujo de compra completo. F3 = operación, reportes e integración con scraping.

---

## 1. Reparto

**Este proyecto (m):** la base que todos usan, las piezas transversales, la integración con los otros equipos y todo el servidor. Son las tareas donde un error afecta a todos y donde conviene una sola mano.

**Otros miembros del equipo de backend:** módulos de negocio autocontenidos, cada uno con su contrato en OpenAPI y sus colecciones definidas. Se reparten en 3 paquetes para que cada persona (o pareja) trabaje en su carpeta sin pisar a los demás.

| Tarea | Quién | Fase | Estado |
| --- | --- | --- | --- |
| B1 Contrato OpenAPI | Este proyecto | F1 | Esqueleto en PR #1 |
| B2 Base del proyecto | Este proyecto | F1 | Hecho en PR #1 |
| B3 Esquemas Mongoose y seed | Este proyecto | F1 | Pendiente |
| B4 Estructura modular y helpers | Este proyecto | F1 | Parcial en PR #1 |
| B5 Autenticación y usuarios | Este proyecto | F1 | Pendiente |
| B6 Catálogo | Miembro, paquete A | F2 | Pendiente |
| B7 Inventario e IMEI | Miembro, paquete A | F2 | Pendiente |
| B8 Carrito, promociones y checkout | Miembro, paquete B | F2 | Pendiente |
| B9 Pagos | Miembro, paquete B | F2 | Pendiente |
| B10 Pedidos, envíos y devoluciones | Miembro, paquete C | F2 | Pendiente |
| B11 Reportes, auditoría y configuración | Miembro, paquete C | F3 | Pendiente |
| B12 Ingesta del scraping | Este proyecto | F3 | Recepción hecha en PR #1 |
| B13 Seguridad y observabilidad | Este proyecto | F3 | Pendiente |
| B15 API de exportación para sistemas externos | Este proyecto (hilo Backend) | F3 | Pendiente |
| B14 Pruebas | Infraestructura de tests: este proyecto. Tests de cada módulo: su dueño | Continuo | Base hecha en PR #1 |
| S1 a S11 Servidor | m | F1 a F3 | Ver sección 4 |

Regla para todos: rama `feature/back-<modulo>` desde `develop`, PR con CI verde y una revisión. Nadie cambia `docs/openapi.yaml`, `src/config`, `src/middleware` o los modelos de otro módulo sin avisar en su PR.

---

## 2. Recursos

### Para cualquier persona de backend

| Recurso | Para qué | Quién lo da |
| --- | --- | --- |
| Acceso de colaborador al repo CRM_Celulares | Ramas y PRs | m (GitHub, Settings → Collaborators) |
| Node.js 22 LTS, Git, VS Code | Desarrollo | Cada quien |
| Docker Desktop (o Docker Engine) | Levantar Mongo y Redis locales con `infra/docker-compose.yml` | Cada quien |
| MongoDB Compass | Ver la base local | Cada quien (gratis) |
| Bruno o Postman | Probar endpoints | Cada quien (gratis) |
| `.env` de desarrollo | Variables locales | Copiar de `.env.example` |
| Usuarios de prueba por rol | Probar permisos | `npm run seed` (B3) |

### Extra por paquete

| Paquete | Recurso adicional |
| --- | --- |
| A (catálogo e inventario) | Carpeta de imágenes de prueba; si se usa Cloudflare R2: credenciales de un bucket de pruebas (las da m) |
| B (carrito, checkout, pagos) | Cuenta en [PayPal Developer](https://developer.paypal.com) con app sandbox; cuenta en [Mercado Pago Developers](https://www.mercadopago.com.mx/developers) con credenciales y usuarios de prueba; un túnel temporal (`cloudflared tunnel --url`) para recibir webhooks en local |
| C (pedidos, reportes) | Cuenta SMTP para correos de prueba (por ejemplo Resend gratis o una contraseña de aplicación de Gmail) |

### Para el servidor (m)

| Recurso | Detalle |
| --- | --- |
| Raspberry Pi | **Recomendado Pi 5 de 8 GB.** Una Pi 4 no puede correr MongoDB 5 o superior (ver S5) |
| Disco | SSD por USB 3 o NVMe de 256 GB o más. **No usar la microSD para MongoDB**: se corrompe y es lenta |
| Energía y temperatura | Fuente oficial (27 W en Pi 5), ventilador o disipador activo |
| Sistema | Raspberry Pi OS Lite 64 bits (Bookworm) o Ubuntu Server 24.04 arm64 |
| Red | Cable Ethernet; IP fija por reserva DHCP en el router |
| Cloudflare | Cuenta con el dominio; permisos para crear túneles (Zero Trust) y registros DNS |
| GitHub | Rol de administrador en el repo: secretos, protección de ramas, runner propio y paquetes (GHCR) |
| Respaldo externo | Opcional: bucket de Cloudflare R2 (10 GB gratis) o una carpeta de Google Drive con `rclone` |

---

## 3. Backend: tareas detalladas

### Este proyecto

#### B1. Contrato OpenAPI (F1)
- Completar `docs/openapi.yaml` con request, response y errores de cada endpoint (auth, catálogo, carrito, checkout, pagos, pedidos, admin, ingesta).
- Fijar los códigos de error estables (`STOCK_INSUFICIENTE`, `CUPON_INVALIDO`, `PEDIDO_NO_PAGABLE`, `TRANSICION_INVALIDA`…).
- Servir la documentación en `GET /api/v1/docs` (swagger-ui-express).
- **Terminado cuando:** el equipo de frontend aprueba el PR. Los paquetes A, B y C implementan contra este archivo.
- **Desbloquea:** frontend y los tres paquetes.

#### B3. Esquemas Mongoose y datos semilla (F1)
- Esquemas en `src/modules/<modulo>/*.model.js` de todas las colecciones de `docs/data-model.md`, para que los paquetes solo escriban lógica.
- Montos en `Decimal128` serializados como texto (`"18999.00"`); `timestamps` con `created_at` y `updated_at`.
- Índices únicos: `users.email`, `products.slug`, `products.variants.sku`, `serial_units.imei`, `stock_levels (sku, warehouse_id)`, `orders.folio`; índice de texto en marca + modelo. Validarlos con el equipo de base de datos.
- `src/seed.js`: 6 marcas, 3 categorías, 1 almacén, 20 teléfonos con 2 a 4 variantes, stock, IMEI de prueba y un usuario por rol.
- **Terminado cuando:** `npm run seed` deja una base local usable y un test comprueba que los índices únicos rechazan duplicados.

#### B4. Estructura modular y helpers (F1)
- Plantilla de módulo (`routes`, `controller`, `service`, `validators`, `model`) con un ejemplo completo para copiar.
- Helpers compartidos: `withTransaction(fn)`, `toMoney()` / `fromMoney()`, `audit(user, accion, entidad, antes, despues)`, cliente de colas `enqueue(cola, datos)`.
- Montar en `app.js` los routers vacíos de cada paquete para que solo los llenen.
- **Terminado cuando:** cada carpeta de módulo tiene su router montado que responde 501 y la guía en `backend/src/modules/README.md`.

#### B5. Autenticación y usuarios (F1)
- Portar `auth.js`, `authorize.js` y `password.js` de mochi-matcha con roles `admin`, `gerente`, `almacen`, `cliente`.
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `GET/POST/PATCH/DELETE /me/addresses`.
- Acceso de 15 min (clientes) y 8 h (staff); refresh token en cookie `httpOnly`, `secure`, `sameSite=strict`, guardado con hash y revocable.
- CRUD de empleados `/admin/users` (gerente y admin). Rate limit de login en Redis (5 por minuto por IP).
- **Terminado cuando:** hay tests de login correcto, contraseña errónea, token vencido, refresh revocado y 403 por rol.

#### B12. Ingesta del scraping (F3)
- La recepción ya existe. Falta: encolar el lote en BullMQ y procesarlo en el worker (empate por `gtin`, luego `match_key`; coincide → `competitor_prices`; si no → `ingest_records` como `nuevo` o `conflicto`).
- Panel: `GET /admin/ingest/records`, `POST …/:id/approve` (crea producto en `borrador`), `POST …/:id/reject`, `GET /admin/competitor-prices?sku=`.
- Entregar al equipo de scraping el token de servicio y la URL pública protegida (ver S6).
- **Regla:** la ingesta nunca cambia precios de venta ni publica productos sola.
- **Terminado cuando:** con el lote de ejemplo un registro coincide y otro queda como `nuevo`.

#### B15. API de exportación para sistemas externos (F3)
- **Archivos:** `src/modules/external/`, contrato propio en `docs/external-api.yaml`.
- Clientes: colección `api_clients` (nombre, hash de la llave, scopes, límite por minuto, vence_en, activo) y CRUD `/admin/api-clients` (gerente). La llave se muestra una sola vez; revocar y rotar.
- Autenticación por `X-API-Key`; scopes `catalog:read`, `stock:read`, `prices:read`, `sales:read`.
- Endpoints: `GET /external/v1/products?updated_since=&cursor=&limit=`, `GET /external/v1/products/:sku`, `GET /external/v1/stock?updated_since=`, `GET /external/v1/prices/history?sku=&from=&to=`, `GET /external/v1/reports/sales?group_by=day|brand|sku&from=&to=`.
- Exportación masiva asíncrona: `POST /external/v1/exports` (`resource`, `format` json, csv o xlsx, `filters`) → `202 { export_id }`; el worker genera el archivo; `GET /external/v1/exports/:id` da estado y enlace firmado que vence en 24 h.
- Paginación por cursor y sincronización incremental por `updated_at` (índices en `products.updated_at` y `stock_levels.updated_at`). CSV con `Accept: text/csv` o `?format=csv`.
- Sin datos personales de clientes: los pedidos solo salen agregados.
- Rate limit por llave en Redis (60/min por defecto) con encabezados `RateLimit-*`; cada llamada se registra en `api_access_logs`.
- **Servidor (S6):** hostname `api.<dominio>` en el túnel de Cloudflare que solo enruta `/external/*`, con regla de rate limit en Cloudflare.
- **Terminado cuando:** tests de llave inválida (401), scope faltante (403), límite excedido (429), paginación por cursor sin huecos ni repetidos, y una exportación CSV que se descarga con el enlace firmado.
- **Depende de:** B6, B7, B11.

#### B13. Seguridad y observabilidad (F3)
- Revisión de validación de entrada en todos los endpoints de los paquetes; rate limit en Redis para endpoints sensibles.
- Sentry en API y worker (plan gratuito); logs sin contraseñas, tokens ni datos de tarjeta; `GET /api/v1/health` también comprueba Redis.

#### B14. Infraestructura de pruebas (continuo)
- Ya existe Jest + Supertest + mongodb-memory-server en replica set. Agregar fábricas de datos (`tests/factories`) y un helper de login por rol para que los paquetes escriban tests rápido.

### Paquete A: catálogo e inventario (miembro del equipo)

#### B6. Catálogo (F2)
- **Archivos:** `src/modules/catalog/`.
- Público: `GET /products` con filtros `q`, `brand`, `category`, `min_price`, `max_price`, `storage_gb`, `condition`, `sort` y paginación; `GET /products/:slug`, `GET /brands`, `GET /categories`. Solo productos `publicado`; disponibilidad por variante leída del servicio de inventario.
- Admin (gerente): CRUD de productos con variantes, marcas y categorías; estados `borrador`, `publicado`, `archivado`.
- `POST /admin/uploads`: jpg, png o webp de hasta 5 MB; se guardan en el volumen de medios de la Pi y Caddy las sirve en `/media` (o en R2 si se decide).
- Cada cambio de precio llama a `audit()`.
- **Terminado cuando:** hay tests de búsqueda por texto con filtros combinados, paginación y 403 para un cliente en rutas de admin.
- **Depende de:** B1, B3, B4, B5.

#### B7. Inventario e IMEI (F2)
- **Archivos:** `src/modules/inventory/`.
- `POST /admin/stock/movements` para `entrada`, `ajuste` y `traspaso`, siempre con `withTransaction` y registro en `stock_movements`.
- `POST /admin/serials`: alta de IMEI en lote (15 dígitos y algoritmo de Luhn); `GET /admin/serials/:imei` con historial.
- `GET /admin/stock` con alerta de stock bajo (umbral en `settings`).
- Exponer en `inventory.service.js` las funciones que usará el paquete B: `reserve(sku, qty, session)`, `release(...)`, `commitSale(...)`.
- **Terminado cuando:** un ajuste nunca deja stock negativo y un IMEI duplicado responde 409.
- **Depende de:** B3, B4, B5.

### Paquete B: compra (miembro del equipo)

#### B8. Carrito, promociones y checkout (F2)
- **Archivos:** `src/modules/cart/`, `src/modules/promotions/`, checkout en `src/modules/orders/checkout.*`.
- `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:sku`, `DELETE /cart/items/:sku`, `POST /cart/coupon`.
- Portar `utils/promociones.js` de mochi-matcha (5 tipos, máximo una promo por pedido) y el CRUD `/admin/promotions`.
- `POST /checkout` con `Idempotency-Key`: en una transacción crea el pedido `pendiente_pago`, copia precios y dirección, reserva stock con `inventory.reserve` y fija `reservado_hasta` a 15 min.
- Job `reservations` en el worker: al vencer cancela el pedido y libera stock.
- **Terminado cuando:** un test de concurrencia con dos checkouts por la última unidad deja ganar solo a uno; el otro recibe 409 `STOCK_INSUFICIENTE`.
- **Depende de:** B7 (`inventory.service`), B5.

#### B9. Pagos (F2)
- **Archivos:** `src/modules/payments/`.
- Interfaz común (`createPayment`, `capturePayment`, `handleWebhook`) con proveedores `paypal` (portar `paypal.controller.js`) y `mercadopago`.
- `POST /payments/:provider/create`, `POST /payments/:provider/capture`, `POST /webhooks/:provider` con verificación de firma.
- Al confirmar, en transacción: pedido a `pagado`, `inventory.commitSale`, movimiento `venta`.
- Idempotencia por `(proveedor, referencia_externa)`.
- **Terminado cuando:** tests con respuestas simuladas de ambos proveedores, incluido un webhook duplicado que no descuenta dos veces; prueba manual de punta a punta en sandbox.
- **Depende de:** B8.

### Paquete C: postventa y reportes (miembro del equipo)

#### B10. Pedidos, envíos y devoluciones (F2)
- **Archivos:** `src/modules/orders/` (salvo checkout).
- Cliente: `GET /orders`, `GET /orders/:id`, `GET /orders/:id/receipt` (PDF con pdfkit), `POST /orders/:id/cancel`, `POST /orders/:id/returns`.
- Admin: `GET /admin/orders` con filtros, `PATCH /admin/orders/:id/status` con máquina de estados, `POST /admin/orders/:id/shipment` (paquetería, guía e IMEI de cada equipo), `PATCH /admin/returns/:id`.
- Correos de confirmación y envío por la cola `emails` (Nodemailer).
- **Terminado cuando:** una transición inválida (por ejemplo `entregado → pagado`) responde 409 y asignar un IMEI ya vendido falla.
- **Depende de:** B8 (estructura de pedido), B7 (IMEI).

#### B11. Reportes, auditoría y configuración (F3)
- **Archivos:** `src/modules/reports/`, `audit/`, `settings/`.
- Agregaciones de MongoDB: ventas por día y marca, más vendidos, inventario valorizado, margen por SKU.
- `POST /admin/reports/export` en xlsx (exceljs) y pdf (pdfkit), portados de mochi-matcha.
- `GET /admin/audit` con filtros; `GET` y `PUT /admin/settings`.
- **Terminado cuando:** los reportes cuadran con un conjunto de pedidos de prueba fijo.
- **Depende de:** B10.

---

## 4. Servidor: tareas detalladas (m)

Cómo se reparte el trabajo: los archivos (compose, Caddyfile, workflows, scripts) van en el repo y m ejecuta lo que requiere la Pi física, el router o los paneles de Cloudflare y GitHub.

#### S1. Repositorio y flujo (F1)
- Ramas `main` (producción) y `develop` (staging); protección con PR, una revisión y CI verde; `CODEOWNERS` por carpeta.
- **Repo:** archivo `CODEOWNERS` y rama `develop`. **m:** activar protección de ramas en GitHub y dar acceso a los miembros.

#### S2. Imágenes para ARM (F1)
- La Pi es arm64: el CI debe construir la imagen del backend para `linux/arm64` (y `amd64` para las laptops) con `docker buildx` y publicarla en GHCR.
- **Repo:** workflow `build.yml`. **Terminado cuando:** `docker pull ghcr.io/mauriggh/crm-celulares-backend:develop` funciona en la Pi.

#### S3. Preparar la Raspberry Pi (F1)
- Instalar el sistema de 64 bits; arrancar desde el SSD o montar el SSD en `/srv` y poner ahí Docker (`data-root`).
- Usuario sin root, SSH solo con llave, `ufw` (solo SSH desde la red local), `fail2ban`, actualizaciones automáticas, Docker y Docker Compose.
- Reserva DHCP para IP fija.
- **Repo:** `infra/scripts/provision.sh` que hace todo lo anterior. **m:** grabar el sistema, conectar la Pi y correr el script.

#### S4. Docker Compose de producción en la Pi (F1)
- Ajustar `infra/docker-compose.prod.yml` a la Pi: límites de memoria por servicio, imagen de Mongo según el modelo de Pi, volumen de medios para imágenes, sin puertos publicados (todo entra por el túnel).
- Dos instancias en la misma Pi: `prod` y `staging` (proyectos de Compose separados, bases `crm_celulares` y `crm_celulares_staging`).
- **Repo:** archivos. **m:** primer `docker compose up` en la Pi.

#### S5. MongoDB en la Pi (F1)
- **La Pi del proyecto es una Pi 4 → `mongo:4.4.18`** (aplicado en el PR #2). Si algún día se cambia a Pi 5: `mongo:8.0` arm64. En Pi 4 solo hasta `mongo:4.4.18` (MongoDB 5+ exige ARMv8.2, que la Pi 4 no tiene); en ese caso `competitor_prices` es colección normal en lugar de time series. Las transacciones funcionan en ambos casos.
- Replica set `rs0` de un nodo, `--auth`, keyFile, `wiredTigerCacheSizeGB` de 1 (Pi de 8 GB) o 0.5 (4 GB). Usuario `crm_api` solo con `readWrite` en su base.
- El equipo de base de datos entra por SSH a través de Cloudflare Access (S6), nunca con Mongo expuesto.
- **Terminado cuando:** la API ejecuta una transacción de prueba en la Pi.

#### S6. Cloudflare Tunnel y DNS (F1)
- Crear un túnel en Cloudflare Zero Trust y correr `cloudflared` como servicio de Compose con su token (sin abrir puertos del router).
- Hostnames públicos: `<dominio>` y `www` → `http://caddy:80` (prod); `staging.<dominio>` → caddy de staging; `ssh.<dominio>` → `ssh://localhost:22` protegido con Cloudflare Access (solo correos del equipo).
- SSL/TLS en modo Full; regla de WAF que bloquee `/internal/*` en todos los hostnames.
- Para sistemas externos (B15): `api.<dominio>` → caddy, solo `/external/*`, con regla de rate limit en Cloudflare.
- Para el equipo de scraping: `ingest.<dominio>` → `/internal/v1/ingest` protegido con un Service Token de Cloudflare Access además del token de la API.
- **Repo:** compose y documentación; crear rutas y DNS con el conector de Cloudflare. **m:** crear el túnel y copiar el token a la Pi (`.env`).

#### S7. Caddy interno (F2)
- Detrás del túnel Caddy escucha en HTTP (Cloudflare pone el HTTPS): `/api/*` → `api:3001`, `/media/*` → volumen de imágenes, resto → `frontend/dist`, `/internal/*` → 403 salvo desde `ingest.<dominio>`.
- **Repo:** actualizar `infra/caddy/Caddyfile`.

#### S8. Despliegue continuo (F2)
- La Pi está detrás del router, así que GitHub no puede entrar por SSH directo. Se usa un **runner propio de GitHub Actions en la Pi**: merge a `develop` → despliega staging; tag `v*` en `main` → despliega producción (`docker compose pull && up -d`, migración de índices, prueba de `/api/v1/health`).
- **Repo:** workflow `deploy.yml`. **m:** registrar el runner en la Pi (GitHub → Settings → Actions → Runners) y cargar los secretos de entorno.

#### S9. Respaldos (F2)
- `mongodump --archive --gzip` diario por cron al SSD, 14 días de retención, y copia fuera de la casa (R2 o Google Drive con `rclone`).
- Prueba de restauración en staging una vez al mes.
- **Repo:** `infra/scripts/backup.sh` y `restore.sh`. **m:** credenciales de R2 o Drive y el cron.

#### S10. Monitoreo (F3)
- Monitor externo (UptimeRobot gratis o notificaciones de salud de Cloudflare) contra `https://<dominio>/api/v1/health`: si la Pi se cae, un monitor dentro de ella no avisa.
- Alertas de temperatura (`vcgencmd measure_temp` > 75 °C), disco > 80% y memoria; rotación de logs de Docker; Sentry para errores.
- **Repo:** script de chequeo y configuración. **m:** cuentas de alertas.

#### S11. Operación (F3)
- `infra/README.md`: desplegar, revertir a la imagen anterior, restaurar respaldo, rotar secretos, qué hacer si se va la luz o el internet (la Pi debe arrancar sola todos los servicios con `restart: unless-stopped`).

---

## 5. Puntos de integración con los otros equipos

| Equipo | Qué le entregamos | Dónde | Qué nos entrega |
| --- | --- | --- | --- |
| Base de datos | MongoDB en la Pi, acceso por SSH con Cloudflare Access, modelo propuesto | `docs/data-model.md` | Validación del modelo, índices y consultas |
| Scraping y limpieza | Contrato del lote, token de la API, Service Token de Cloudflare, URL `ingest.<dominio>` | `docs/contracts/ingest-batch.schema.json` | Lotes limpios con `Idempotency-Key` |
| Sistemas externos | Llave de API con scopes, contrato `docs/external-api.yaml`, `api.<dominio>` | `/external/v1` | Consultas y exportaciones dentro de su límite |
| Frontend | Contrato de la API, `staging.<dominio>`, usuarios de prueba | `docs/openapi.yaml`, `/api/v1/docs` | Build estático que sirve Caddy |

## 6. Preguntas abiertas
- Resuelto: la Pi es una Pi 4, así que MongoDB 4.4.18 (sin colecciones time series). Falta confirmar la RAM para fijar `wiredTigerCacheSizeGB`.
- ¿Cuántas personas hay en el equipo de backend además de ti? Con menos de tres, los paquetes se combinan (A+C y B).
- ¿Imágenes de productos en el SSD de la Pi o en Cloudflare R2? Por defecto, en la Pi.
- ¿El equipo de DB diseña el modelo o solo lo valida? Por ahora el backend propone y DB valida.
