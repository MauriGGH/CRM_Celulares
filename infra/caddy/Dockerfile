# syntax=docker/dockerfile:1
# Imagen "web": compila el frontend (Vite) y lo sirve con Caddy, que además
# hace de proxy inverso hacia la API. Contexto de build: raíz del repo.
FROM node:22-alpine AS build
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

FROM caddy:2.8-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
