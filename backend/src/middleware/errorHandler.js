/**
 * Handler de errores único. Responde siempre
 * { error: { code, message, details } }.
 */
const logger = require('../utils/logger');

module.exports = (err, req, res, _next) => {
  if (err.status && err.code) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details || {} },
    });
  }
  if (err.name === 'ValidationError') {
    return res.status(422).json({
      error: { code: 'VALIDACION', message: 'Datos inválidos', details: err.errors },
    });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'JSON_INVALIDO', message: 'JSON inválido', details: {} } });
  }
  logger.error({ err, path: req.path }, 'Error no controlado');
  res.status(500).json({ error: { code: 'ERROR_INTERNO', message: 'Error interno del servidor', details: {} } });
};
