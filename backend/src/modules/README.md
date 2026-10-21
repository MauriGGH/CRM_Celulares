# Módulos del backend

Cada módulo es una carpeta autocontenida. Regla: un módulo solo toca **sus** colecciones;
si necesita datos de otro, llama a su `service`, no a su modelo.

| Módulo | Ruta base | Tareas | Estado |
| --- | --- | --- | --- |
| health | `/api/v1/health` | — | Hecho |
| ingest | `/internal/v1/ingest` | B12 | Recepción hecha; falta el worker |
| auth | `/api/v1/auth` | B5 | Pendiente |
| users | `/api/v1/admin/users` | B5 | Pendiente |
| catalog | `/api/v1/products`, `/api/v1/admin/products` | B6 | Pendiente |
| inventory | `/api/v1/admin/stock`, `/api/v1/admin/serials` | B7 | Pendiente |
| cart | `/api/v1/cart` | B8 | Pendiente |
| orders | `/api/v1/checkout`, `/api/v1/orders` | B8, B10 | Pendiente |
| payments | `/api/v1/payments`, `/api/v1/webhooks` | B9 | Pendiente |
| promotions | `/api/v1/admin/promotions` | B8 | Pendiente |
| reports | `/api/v1/admin/reports` | B11 | Pendiente |
| audit | `/api/v1/admin/audit` | B11 | Pendiente |
| settings | `/api/v1/admin/settings` | B11 | Pendiente |

Las colecciones y sus campos están en [`docs/data-model.md`](../../../docs/data-model.md).
