/**
 * App Express. Monta middlewares globales y registra cada módulo bajo /api/v1.
 * Para agregar un módulo: crea src/modules/<modulo>/<modulo>.routes.js y móntalo aquí.
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const logger = require('./utils/logger');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

const healthRoutes = require('./modules/health/health.routes');
const ingestRoutes = require('./modules/ingest/ingest.routes');

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '5mb' })); // los lotes de ingesta pueden pesar
app.use(pinoHttp({ logger }));

// API pública (consume el frontend)
app.use('/api/v1/health', healthRoutes);
// TODO(backend): montar auth, users, catalog, inventory, cart, orders,
// payments, promotions, reports, audit y settings (ver src/modules/README.md)

// API interna (solo red de Docker; Caddy la bloquea desde Internet)
app.use('/internal/v1/ingest', ingestRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
