/**
 * GET /api/v1/health — lo usan Docker, Caddy y Uptime Kuma.
 * Responde 200 si MongoDB (y Redis, cuando está configurado) responden; 503 si no.
 */
const router = require('express').Router();
const mongoose = require('mongoose');
const { getRedis } = require('../../config/redis');

async function redisStatus() {
  const redis = getRedis();
  if (!redis) return 'deshabilitado';
  try {
    const pong = await Promise.race([redis.ping(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1000))]);
    return pong === 'PONG' ? 'conectado' : 'error';
  } catch {
    return 'desconectado';
  }
}

router.get('/', async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const redis = await redisStatus();
  const ok = mongoOk && redis !== 'desconectado' && redis !== 'error';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degradado',
    mongo: mongoOk ? 'conectado' : 'desconectado',
    redis,
    time: new Date().toISOString(),
  });
});

module.exports = router;
