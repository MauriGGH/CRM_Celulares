# Se construye desde la raíz del repo para incluir docs/contracts:
#   docker build -f backend/Dockerfile .
FROM node:22-alpine AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY --from=deps /app/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY docs/contracts /app/docs/contracts
# Volumen de imágenes de productos (media-data en producción), escribible por node.
RUN mkdir -p /app/media && chown node:node /app/media
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:3001/api/v1/health || exit 1
CMD ["node", "src/server.js"]
