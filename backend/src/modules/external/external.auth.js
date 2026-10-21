/**
 * Autenticación de sistemas externos en /external/v1 (B15).
 * Llave `ck_<prefix>_<secreto>` en `X-API-Key`. Se guarda solo su HMAC; cada
 * cliente tiene scopes y su propio límite por minuto (Redis si hay, si no
 * memoria) que se informa con los encabezados RateLimit-*. Cada llamada queda
 * en api_access_logs.
 */
const crypto = require('crypto');
const ApiClient = require('./api-client.model');
const ApiAccessLog = require('./api-access-log.model');
const config = require('../../config/env');
const logger = require('../../utils/logger');
const { hit, clientIp } = require('../../middleware/rateLimit');
const { AppError } = require('../../utils/errors');

const hashKey = (raw) => crypto.createHmac('sha256', config.jwt.refreshSecret).update(`api-key:${raw}`).digest('hex');

/** Llave nueva `{ raw, prefix, key_hash }`; `raw` se muestra una sola vez. */
function generateKey() {
  const prefix = crypto.randomBytes(4).toString('hex');
  const raw = `ck_${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
  return { raw, prefix, key_hash: hashKey(raw) };
}

const invalid = () => new AppError(401, 'API_KEY_INVALIDA', 'API key inválida, inactiva o vencida');

async function apiKeyAuth(req, res, next) {
  const started = Date.now();
  try {
    const raw = req.get('x-api-key') || '';
    const m = /^ck_([0-9a-f]{8})_[A-Za-z0-9_-]{20,}$/.exec(raw);
    if (!m) throw invalid();
    const client = await ApiClient.findOne({ prefix: m[1] }).select('+key_hash');
    const given = Buffer.from(hashKey(raw));
    const ok = client && client.key_hash.length === given.length && crypto.timingSafeEqual(Buffer.from(client.key_hash), given);
    if (!ok || !client.activo || (client.vence_en && client.vence_en < new Date())) throw invalid();

    res.on('finish', () => {
      ApiAccessLog.create({
        client_id: client._id, method: req.method, path: req.originalUrl.slice(0, 500), status: res.statusCode,
        duracion_ms: Date.now() - started, ip: clientIp(req),
      }).catch((err) => logger.warn({ err }, 'no se pudo registrar el acceso externo'));
    });

    const rl = await hit(`apiclient:${client.id}`, client.limite_por_minuto, 60_000);
    res.set({ 'RateLimit-Limit': String(rl.limit), 'RateLimit-Remaining': String(rl.remaining), 'RateLimit-Reset': String(rl.reset) });
    if (rl.blocked) {
      res.set('Retry-After', String(rl.reset));
      throw new AppError(429, 'DEMASIADAS_SOLICITUDES', `Límite de ${rl.limit} solicitudes por minuto`, { retryAfter: rl.reset });
    }
    if (!client.ultimo_uso_en || Date.now() - client.ultimo_uso_en.getTime() > 60_000) {
      ApiClient.updateOne({ _id: client._id }, { ultimo_uso_en: new Date() }).catch(() => {});
    }
    req.apiClient = { id: client.id, nombre: client.nombre, scopes: client.scopes };
    res.set('Cache-Control', 'no-store');
    next();
  } catch (err) { next(err); }
}

/** @param {string} scope */
const requireScope = (scope) => (req, _res, next) => (
  req.apiClient?.scopes.includes(scope)
    ? next()
    : next(new AppError(403, 'SCOPE_INSUFICIENTE', `La llave no tiene el permiso ${scope}`, { requerido: scope }))
);

// ─── Enlaces firmados de descarga ─────────────────────────────────────────

const sign = (id, expires) => crypto.createHmac('sha256', config.jwt.refreshSecret).update(`export:${id}:${expires}`).digest('hex');

/** URL de descarga válida hasta `expiresAt`, sin API key. */
function signedUrl(id, expiresAt) {
  const expires = Math.floor(expiresAt.getTime() / 1000);
  return `${config.externalPublicUrl}/external/v1/exports/${id}/download?expires=${expires}&sig=${sign(id, expires)}`;
}

function verifySignature(id, expires, sig) {
  if (!/^\d+$/.test(String(expires)) || !/^[0-9a-f]{64}$/.test(String(sig))) return false;
  if (Number(expires) * 1000 < Date.now()) return false;
  return crypto.timingSafeEqual(Buffer.from(sign(id, expires)), Buffer.from(sig));
}

module.exports = { apiKeyAuth, requireScope, generateKey, hashKey, signedUrl, verifySignature };
