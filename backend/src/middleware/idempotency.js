/**
 * Soporte de `Idempotency-Key` para escrituras sensibles (checkout, pagos).
 * - Primera vez: ejecuta el handler y guarda status + cuerpo 24 h.
 * - Misma llave y mismo cuerpo: devuelve la respuesta guardada.
 * - Misma llave con otro cuerpo: 422 IDEMPOTENCY_KEY_REUTILIZADA.
 * - Misma llave mientras la primera sigue en curso: 409 SOLICITUD_EN_CURSO.
 * El alcance es por usuario y ruta, así dos clientes no chocan.
 */
const crypto = require('crypto');
const IdempotencyKey = require('../utils/idempotency-key.model');
const { AppError, badRequest } = require('../utils/errors');

/**
 * @param {{required?: boolean}} [opts]
 * @returns {import('express').RequestHandler}
 */
function idempotency({ required = false } = {}) {
  return async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key) return required ? next(badRequest('Falta el encabezado Idempotency-Key')) : next();
    if (key.length > 200) return next(badRequest('Idempotency-Key demasiado largo'));

    const scope = `${req.user?.id || 'anon'}:${req.method}:${req.baseUrl}${req.path}`;
    const request_hash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');

    try {
      await IdempotencyKey.create({ scope, key, request_hash });
    } catch (err) {
      if (err.code !== 11000) return next(err);
      const prev = await IdempotencyKey.findOne({ scope, key }).lean();
      if (!prev) return next(new AppError(409, 'SOLICITUD_EN_CURSO', 'Reintenta en unos segundos'));
      if (prev.request_hash !== request_hash) {
        return next(new AppError(422, 'IDEMPOTENCY_KEY_REUTILIZADA', 'La llave ya se usó con otro cuerpo'));
      }
      if (prev.status_code == null) {
        return next(new AppError(409, 'SOLICITUD_EN_CURSO', 'La solicitud original sigue en proceso'));
      }
      res.set('Idempotent-Replay', 'true');
      return res.status(prev.status_code).json(prev.response_body);
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const done = res.statusCode < 500
        ? IdempotencyKey.updateOne({ scope, key }, { status_code: res.statusCode, response_body: body })
        : IdempotencyKey.deleteOne({ scope, key }); // un 5xx se puede reintentar
      done.catch(() => {}).finally(() => originalJson(body));
      return res;
    };
    next();
  };
}

module.exports = idempotency;
