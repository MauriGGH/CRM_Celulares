# Frontend (otro equipo)

El frontend lo rediseña otro equipo en React + Vite. Esta carpeta queda reservada para integrarlo.

## Cómo se integra

- **Contrato de la API:** [`docs/openapi.yaml`](../docs/openapi.yaml), también visible en `GET /api/v1/docs` cuando el backend lo publique.
- **Base URL:** `/api/v1` (mismo dominio; Caddy enruta `/api/*` al backend, sin CORS en producción).
- **Desarrollo local:** proxy de Vite a `http://localhost:3001`:
  ```js
  // vite.config.js
  server: { proxy: { '/api': 'http://localhost:3001' } }
  ```
- **Autenticación:** `Authorization: Bearer <token>`; el refresh token llega en cookie `httpOnly`, usar `credentials: 'include'`.
- **Despliegue:** `npm run build` genera `dist/`; Caddy sirve ese directorio. Ver `infra/`.
