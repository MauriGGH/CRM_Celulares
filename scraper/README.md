# Scraping y limpieza de datos (otro equipo)

Este módulo lo desarrolla otro equipo. Esta carpeta queda reservada por si deciden integrarlo en este repo.

## Cómo se integra con el backend

- **Único punto de entrada:** `POST /internal/v1/ingest/batches` (red interna, no expuesto a Internet).
- **Autenticación:** `Authorization: Bearer <INGEST_SERVICE_TOKEN>` (lo entrega el equipo de servidor).
- **Idempotencia:** encabezado `Idempotency-Key` obligatorio; reenviar la misma llave no duplica el lote.
- **Contrato:** [`docs/contracts/ingest-batch.schema.json`](../docs/contracts/ingest-batch.schema.json) (JSON Schema 2020-12, versión 1.0) y
  [ejemplo](../docs/contracts/examples/ingest-batch.example.json). Hasta 1000 registros por lote, precios en MXN como texto `"18999.00"`.
- **Respuestas:** `202 { batch_id, status: "en_cola" }`, `200` si la llave ya existía, `401` sin token, `422 LOTE_INVALIDO` con el detalle de errores.
- **Estado:** `GET /internal/v1/ingest/batches/:id` devuelve estado y conteos (`coincide`, `nuevo`, `conflicto`, `invalido`).
- **Llave de empate:** `marca|modelo|almacenamiento|color` en minúsculas, sin acentos y con guiones (ver `docs/data-model.md`).

El scraping nunca escribe en la base de ventas; sus datos crudos viven en su propia base.
Cambios al contrato: PR que aprueben backend y scraping.

## Probar contra el backend local

```bash
curl -X POST http://localhost:3001/internal/v1/ingest/batches \
  -H "Authorization: Bearer $INGEST_SERVICE_TOKEN" \
  -H "Idempotency-Key: prueba-1" \
  -H "Content-Type: application/json" \
  --data @docs/contracts/examples/ingest-batch.example.json
```
