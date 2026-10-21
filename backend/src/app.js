/**
 * App Express. Monta middlewares globales y registra cada módulo bajo /api/v1.
 * Para agregar un módulo: crea src/modules/<modulo>/<modulo>.routes.js y móntalo aquí.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const cookieParser = require('cookie-parser');

const env = require('./config/env');
const logger = require('./utils/logger');
const sentry = require('./utils/sentry');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
require('./jobs/handlers'); // procesadores para el modo inline de las colas

sentry.init('api');

const healthRoutes = require('./modules/health/health.routes');
const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
const catalog = require('./modules/catalog/catalog.routes');
const inventoryRoutes = require('./modules/inventory/inventory.routes');
const cartRoutes = require('./modules/cart/cart.routes');
const orders = require('./modules/orders/orders.routes');
const { paymentsRouter, webhooksRouter } = require('./modules/payments/payments.routes');
const promotionsRoutes = require('./modules/promotions/promotions.routes');
const reportsRoutes = require('./modules/reports/reports.routes');
const auditRoutes = require('./modules/audit/audit.routes');
const settingsRoutes = require('./modules/settings/settings.routes');
const ingestRoutes = require('./modules/ingest/ingest.routes');
const ingestAdminRoutes = require('./modules/ingest/ingest.admin.routes');
const modelosRoutes = require('./modules/modelos/modelos.routes');
const external = require('./modules/external/external.routes');

const app = express();

app.set('trust proxy', env.trustProxy); // detrás de Caddy en la red de Docker
app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: '5mb' })); // los lotes de ingesta pueden pesar
app.use(cookieParser());
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url.startsWith('/api/v1/health') } }));

// Imágenes subidas sin S3 (en producción Caddy sirve /media directo del volumen)
app.use('/media', express.static(env.mediaDir, { fallthrough: true, index: false }));

// Documentación del contrato (docs/openapi.yaml)
const openapiPath = [path.join(__dirname, '../../docs/openapi.yaml'), path.join(__dirname, '../openapi.yaml')].find((p) => fs.existsSync(p));
if (openapiPath) {
  const swaggerUi = require('swagger-ui-express');
  const spec = require('yaml').parse(fs.readFileSync(openapiPath, 'utf8'));
  app.get('/api/v1/openapi.json', (_req, res) => res.json(spec));
  app.use('/api/v1/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(spec));
}
const externalSpecPath = path.join(path.dirname(openapiPath || path.join(__dirname, '../../docs/x')), 'external-api.yaml');
if (fs.existsSync(externalSpecPath)) {
  const spec = require('yaml').parse(fs.readFileSync(externalSpecPath, 'utf8'));
  app.get('/external/v1/openapi.json', (_req, res) => res.json(spec));
}

// API pública (consume el frontend)
const v1 = express.Router();
v1.use('/health', healthRoutes);
v1.use('/auth', authRoutes);
v1.use('/', usersRoutes); // /me, /me/addresses, /admin/users
v1.use('/', catalog.publicRouter); // /products, /brands, /categories
v1.use('/admin', catalog.adminRouter);
v1.use('/admin', inventoryRoutes);
v1.use('/cart', cartRoutes);
v1.use('/', orders.clientRouter); // /checkout, /orders
v1.use('/admin', orders.adminRouter);
v1.use('/payments', paymentsRouter);
v1.use('/webhooks', webhooksRouter);
v1.use('/admin', promotionsRoutes);
v1.use('/admin/reports', reportsRoutes);
v1.use('/admin/audit', auditRoutes);
v1.use('/admin/settings', settingsRoutes);
v1.use('/admin', ingestAdminRoutes);
v1.use('/admin', modelosRoutes);
v1.use('/admin', external.adminRouter);
app.use('/api/v1', v1);

// Alias para healthchecks que aún usan /health
app.use('/health', healthRoutes);

// API interna (solo red de Docker; Caddy la bloquea desde Internet)
app.use('/internal/v1/ingest', ingestRoutes);

// API de solo lectura para sistemas externos (B15, docs/external-api.yaml)
app.use('/external/v1', external.externalRouter);

app.use(notFound);
sentry.setupExpress(app);
app.use(errorHandler);

module.exports = app;
