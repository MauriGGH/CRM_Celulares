# Cómo contribuir

## Carpetas y equipos

| Carpeta | Equipo |
|---|---|
| `backend/` | Backend (API Node.js + worker) |
| `infra/`, `.github/`, `compose.yaml` | Servidor / infraestructura |
| `docs/` | Contratos compartidos (`openapi.yaml`, `contracts/`, `data-model.md`) |
| `frontend/` | Equipo de frontend (se desarrolla fuera de este proyecto; aquí solo se integra) |
| `scraper/` | Equipo de scraping y limpieza de datos (ídem) |

Cada equipo trabaja en su carpeta. Un cambio a un contrato de `docs/` se hace por PR y lo
aprueban los dos equipos involucrados.

## Ramas

- `main`: producción. Solo recibe merges desde `develop` (o `hotfix/*`). Cada release se marca con un tag `v1.2.3`, que despliega a producción.
- `develop`: integración. Cada merge despliega a staging.
- `feature/<area>-<tema>`: trabajo diario, p. ej. `feature/back-checkout`, `feature/infra-backups`. PR hacia `develop`.
- `hotfix/<tema>`: arreglo urgente desde `main`; luego se integra también a `develop`.

Protección de `main` y `develop`: PR obligatorio, 1 revisión aprobada (CODEOWNERS), CI en verde y sin push directo.

## Commits: Conventional Commits

```
<tipo>(<ámbito>): <resumen en minúsculas, imperativo>
```

Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`, `perf`.
Ámbitos sugeridos: `auth`, `catalog`, `inventory`, `cart`, `orders`, `payments`, `ingest`, `infra`, `ci`.

Ejemplos: `feat(cart): reserva de stock por 15 minutos`, `fix(infra): rotación de logs de caddy`.
Un cambio que rompe un contrato lleva `!` (`feat(api)!: ...`) y explica la migración en el cuerpo.

## Pull requests

- Pequeños y de un solo tema. Describir qué cambia, cómo se probó y si toca variables de entorno o contratos.
- Si agregas una variable de entorno, actualiza `.env.example` y avisa a infra.
- No subir `.env`, llaves ni datos reales de clientes.

## Entorno local

Ver `infra/README.md`. Resumen: `cp .env.example .env`, generar `MONGO_REPLICA_KEY` y `docker compose up -d`.
