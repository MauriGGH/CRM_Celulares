# Cómo colaborar

## Ramas

- `main`: producción. Solo recibe merges desde `develop` o hotfixes. Cada tag `v*` despliega a producción.
- `develop`: integración. Cada merge despliega a staging.
- `feature/<equipo>-<tema>`: trabajo diario. Ejemplos: `feature/back-catalogo`, `feature/infra-caddy`, `feature/back-ingesta`.
- `fix/<tema>`: correcciones.

Todo entra por Pull Request hacia `develop`, con al menos una revisión y CI en verde.

## Commits

Formato [Conventional Commits](https://www.conventionalcommits.org/es/) con el alcance del equipo:

```
feat(backend): agrega endpoint de catálogo con filtros
fix(backend): corrige cálculo de stock reservado
chore(infra): agrega respaldo diario de MongoDB
docs(contracts): sube schema_version del lote a 1.1
```

## Dueños de cada carpeta

| Carpeta | Dueño | Revisa también |
| --- | --- | --- |
| `backend/` | Equipo backend | — |
| `infra/`, `.github/` | Equipo servidor | — |
| `docs/openapi.yaml` | Backend | Frontend |
| `docs/contracts/` | Backend | Scraping debe aprobar |
| `docs/data-model.md` | Backend | Base de datos debe aprobar |
| `frontend/`, `scraper/` | Otros equipos | — |

## Convenciones de código

- **Idioma:** código (variables, funciones) en inglés; comentarios, mensajes de error al usuario y documentación en español.
- **API:** JSON en `snake_case`, montos como texto decimal (`"18999.00"`), moneda MXN, fechas ISO 8601 en UTC.
- **Errores:** `{ "error": { "code": "STOCK_INSUFICIENTE", "message": "...", "details": {} } }`.
- **Paginación:** `?page=1&limit=20` → `{ "data": [...], "meta": { "page", "limit", "total" } }`.
- **Backend:** JavaScript CommonJS con JSDoc, un módulo por carpeta en `backend/src/modules/<modulo>/` con `routes`, `controller`, `service`, `model`, `validators`.
- **Secretos:** nunca en el repo. Solo `.env.example` con valores de ejemplo.

## Antes de abrir un PR

```bash
# backend
cd backend && npm run lint && npm test
```
