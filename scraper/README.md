# scraper/

Servicio Python 3.12 de scraping y limpieza de datos. **Lo implementa el equipo de datos (tareas D1–D10); esta carpeta es solo el punto de integración que deja infra.** No hay código aquí todavía.

Infra ya deja listo:

- `Dockerfile` multi-etapa con usuario sin root. Espera un `requirements.txt` aquí.
- Servicio `scraper` en `docker-compose.yml` bajo el perfil `scraper`
  (`docker compose --profile scraper up scraper`).
- Usuario de MongoDB `pos_scraper` con readWrite solo en la base `scraping`
  (páginas crudas, listados crudos y limpios); sin acceso a la base de la tienda.
- Variables `SCRAPER_MONGO_URI`, `INGEST_URL` e `INGEST_API_KEY` en `.env.example`.
- Job de CI que corre `pytest` en cuanto exista `scraper/requirements.txt`.

El scraper solo entrega lotes limpios a `POST http://api:3001/internal/v1/ingest/batches`
por la red interna de Docker. `/internal/*` está bloqueado desde internet en Caddy.
