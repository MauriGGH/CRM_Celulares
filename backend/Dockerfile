# syntax=docker/dockerfile:1
# Imagen de la API y del worker (mismo código, distinto comando).
# Etapa 1: dependencias de producción con caché de npm.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

# Etapa 2: imagen final mínima, usuario sin privilegios. El reaping de señales
# lo hace Docker con "init: true" en compose; el healthcheck usa el wget de busybox.
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "src/server.js"]
