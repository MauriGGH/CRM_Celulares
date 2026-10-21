/**
 * Sentry opcional: solo se inicializa si hay SENTRY_DSN.
 */
const env = require('../config/env');

let enabled = false;

function init(serverName) {
  if (!env.sentryDsn || enabled) return;
  const Sentry = require('@sentry/node');
  Sentry.init({ dsn: env.sentryDsn, environment: env.nodeEnv, serverName, tracesSampleRate: 0 });
  enabled = true;
}

/** Middleware de errores de Express (no-op sin DSN). */
function setupExpress(app) {
  if (enabled) require('@sentry/node').setupExpressErrorHandler(app);
}

module.exports = { init, setupExpress };
