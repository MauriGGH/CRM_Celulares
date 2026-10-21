# Modelo de datos (MongoDB)

Propuesta del backend para acordar con el equipo de base de datos (MongoDB corre en nuestro VPS): colecciones, campos e índices que el backend
necesita en la base `crm_celulares`. Requisito: MongoDB 4.4 o superior en **replica set** (transacciones). La Pi 4 del proyecto corre 4.4.18, así que no se usan colecciones time series.
Si el equipo de scraping usa MongoDB para sus datos crudos, debe ser otra base; el backend no la lee.

Convenciones: campos en `snake_case`; `created_at` y `updated_at` con `timestamps` de Mongoose; montos en
`Decimal128` y moneda MXN; referencias con `ObjectId`. Se embebe lo que se lee junto y no crece sin límite;
se referencia lo que tiene vida propia o crece.

## crm_celulares

| Colección | Documento (campos clave) | Índices | Notas |
| --- | --- | --- | --- |
| `users` | email, password_hash, nombre, telefono, rol (`admin`, `gerente`, `almacen`, `cliente`), is_active, addresses: [{ calle, colonia, ciudad, estado, cp, es_principal }] | email único, rol | Direcciones embebidas (pocas por usuario) |
| `brands` | nombre, slug, logo_url | slug único | |
| `categories` | nombre, slug, parent_id | slug único, parent_id | Árbol: celulares, tablets, accesorios |
| `products` | brand_id, category_id, modelo, slug, descripcion, condicion (`nuevo`, `reacondicionado`, `usado`), garantia_meses, estado (`borrador`, `publicado`, `archivado`), specs: {…}, images: [url], variants: [{ sku, color, almacenamiento_gb, ram_gb, precio, precio_antes, costo, gtin, match_key, is_active, images: [url] }] | slug único, `variants.sku` único, `variants.gtin`, `variants.match_key`, texto en modelo + marca, (estado, brand_id, category_id) | Variantes **embebidas**: el catálogo se lee completo en una consulta. `match_key` = `marca\|modelo\|almacenamiento\|color` normalizado, usado por la ingesta |
| `warehouses` | nombre, direccion, is_active | | Normalmente uno; permite crecer a varios almacenes |
| `stock_levels` | sku, product_id, warehouse_id, disponible, reservado | (sku, warehouse_id) único | Se actualiza con `$inc` dentro de transacciones |
| `serial_units` | imei, sku, warehouse_id, estado (`disponible`, `reservado`, `vendido`, `devuelto`), order_id | imei único, (sku, estado) | Rastreo por IMEI para garantía |
| `stock_movements` | sku, warehouse_id, tipo (`entrada`, `venta`, `ajuste`, `devolucion`, `traspaso`), cantidad, referencia, user_id | (sku, created_at) | Solo inserción, nunca se edita |
| `carts` | user_id, items: [{ sku, product_id, cantidad }], coupon_code | user_id único | Items embebidos |
| `orders` | folio, user_id, estado, items: [{ sku, product_id, nombre, cantidad, precio_unitario, imei }], subtotal, descuento, envio, total, promotion_id, shipping_address: {…}, shipment: { paqueteria, guia, estado, enviado_en, entregado_en }, status_history: [{ estado, at, user_id }], reservado_hasta | folio único, (user_id, created_at), estado | Items, dirección y envío embebidos como copia al momento de comprar. Estados: `pendiente_pago` → `pagado` → `preparando` → `enviado` → `entregado`, o `cancelado` / `reembolsado` |
| `payments` | order_id, proveedor (`paypal`, `mercadopago`), referencia_externa, estado, monto, respuesta: {…} | order_id, (proveedor, referencia_externa) único | Separado: los webhooks llegan por referencia externa |
| `returns` | order_id, sku, imei, motivo, tipo (`devolucion`, `garantia`), estado | order_id, estado | |
| `promotions` | Igual que mochi-matcha (tipo de descuento, valor, vigencia, productos aplicables) | activo, vigencia | El motor `promociones.js` se porta casi igual |
| `audit_logs` | user_id, accion, entidad, entidad_id, antes, despues | (entidad, entidad_id), created_at | |
| `settings` | clave, valor | clave único | |
| `ingest_batches` | source, schema_version, scraped_at, idempotency_key, status, record_count, records (hasta procesarse), stats | idempotency_key único, status | Ya implementada en `backend/src/modules/ingest` |
| `ingest_records` | batch_id, source, external_id, source_url, payload, resultado (`coincide`, `nuevo`, `conflicto`, `invalido`), product_id, sku, decision (`pendiente`, `aprobado`, `rechazado`), revisado_por | (resultado, decision), (source, external_id) | Cola de revisión del gerente |
| `competitor_prices` | captured_at, meta: { sku, source }, product_id, precio, en_stock, url, ingest_record_id | (meta.sku, captured_at), (meta.source, captured_at) | Histórico de precios de la competencia. Colección normal (4.4 no tiene time series) |
| `modelos` | id (número), marca, modelo, almacenamiento ("128GB / 256GB"), memoria_ram, procesador, pantalla, medidas, bateria, camara_principal, sistema_operativo, precio ("$899 USD"), imagen, url_gsmarena | los del equipo de DB | **Del equipo de DB** (fichas de GSMArena, `infra/scripts/import-modelos.sh`). El backend solo la lee y `migrate` no toca sus índices. `POST /admin/modelos/:id/import` crea un producto en borrador |
| `refresh_tokens` | user_id, token_hash, expires_at, revoked_at, replaced_by, user_agent | token_hash único, user_id, TTL en expires_at | Rotación en cada uso; reusar uno ya rotado revoca todas las sesiones del usuario |
| `webhook_events` | proveedor, event_id, payload, procesado_en | (proveedor, event_id) único | Deduplica webhooks |
| `idempotency_keys` | scope (usuario + ruta), key, request_hash, status_code, response_body | (scope, key) único, TTL 24 h | Respuestas repetibles de checkout y pagos |
| `counters` | _id (p. ej. `orders-2026`), seq | | Folios `CEL-2026-000001` |
| `api_clients` | nombre, prefix, key_hash, scopes, limite_por_minuto, vence_en, activo, ultimo_uso_en | prefix único | Sistemas externos de `/external/v1` (B15) |
| `api_access_logs` | client_id, method, path, status, duracion_ms, ip, created_at | (client_id, created_at), TTL 90 días | Bitácora de la API externa |
| `export_jobs` | client_id, resource, format, filters, status, file_id, rows, bytes, expires_at | (client_id, created_at), (status, expires_at) | Archivos en GridFS `export_files`, se borran a las 24 h |

### Transacciones

MongoDB solo permite transacciones multi-documento en replica set. Por eso `infra/` levanta Mongo con `--replSet rs0`
aunque sea un solo nodo. Usar `session.withTransaction()` en:

- checkout (crear pedido + reservar `stock_levels` + marcar `serial_units`)
- captura de pago (pedido a `pagado` + movimiento de stock `venta`)
- preparación del envío (asignar IMEI de `serial_units` al pedido)
- cancelación, expiración de reserva y devoluciones
