# Módulos del backend

Cada módulo es una carpeta autocontenida. Regla: un módulo solo toca **sus** colecciones;
si necesita datos de otro, llama a su `service`, no a su modelo.

| Módulo | Ruta base | Tareas | Colecciones |
| --- | --- | --- | --- |
| health | `/api/v1/health` | B2 | — |
| auth | `/api/v1/auth` | B5 | `refresh_tokens` |
| users | `/api/v1/me`, `/api/v1/admin/users` | B5 | `users` (direcciones embebidas) |
| catalog | `/api/v1/products`, `/api/v1/admin/products`, `/brands`, `/categories`, `/uploads` | B6 | `products` (variantes embebidas), `brands`, `categories` |
| modelos | `/api/v1/admin/modelos` | B6 | `modelos` (solo lectura, la llena el equipo de DB) |
| inventory | `/api/v1/admin/stock`, `/serials`, `/warehouses` | B7 | `stock_levels`, `serial_units`, `stock_movements`, `warehouses` |
| cart | `/api/v1/cart` | B8 | `carts` |
| promotions | `/api/v1/admin/promotions` | B8 | `promotions` |
| orders | `/api/v1/checkout`, `/api/v1/orders`, `/api/v1/admin/orders`, `/admin/returns` | B8, B10 | `orders`, `returns` |
| payments | `/api/v1/payments`, `/api/v1/webhooks` | B9 | `payments`, `webhook_events` |
| reports | `/api/v1/admin/reports` | B11 | — |
| audit | `/api/v1/admin/audit` | B11 | `audit_logs` |
| settings | `/api/v1/admin/settings` | B11 | `settings` |
| ingest | `/internal/v1/ingest`, `/api/v1/admin/ingest`, `/admin/competitor-prices` | B12 | `ingest_batches`, `ingest_records`, `competitor_prices` |
| external | `/external/v1`, `/api/v1/admin/api-clients` | B15 | `api_clients`, `api_access_logs`, `export_jobs`, GridFS `export_files` |

Contratos: [`docs/openapi.yaml`](../../../docs/openapi.yaml) (frontend) y
[`docs/external-api.yaml`](../../../docs/external-api.yaml) (sistemas externos).
Las colecciones y sus campos están en [`docs/data-model.md`](../../../docs/data-model.md).
