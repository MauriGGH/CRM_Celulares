/**
 * Autenticación servicio a servicio para /internal/*.
 * El scraper envía `Authorization: Bearer <INGEST_API_KEY>`.
 * Caddy además bloquea /internal desde Internet.
 */
const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/AppError');

module.exports = (req, _res, next) => {
  const expected = env.ingestServiceToken || '';
  const given = (req.headers.authorization || '').replace(/^Bearer /, '');
  const ok = expected.length > 0
    && given.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return next(new AppError(401, 'TOKEN_SERVICIO_INVALIDO', 'Token de servicio inválido'));
  next();
};
