/**
 * GET /api/v1/health — lo usan Docker, Caddy y Uptime Kuma.
 * Responde 200 si MongoDB está conectado, 503 si no.
 */
const router = require('express').Router();
const mongoose = require('mongoose');

router.get('/', (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  res.status(mongoOk ? 200 : 503).json({
    status: mongoOk ? 'ok' : 'degradado',
    mongo: mongoOk ? 'conectado' : 'desconectado',
    time: new Date().toISOString(),
  });
});

module.exports = router;
