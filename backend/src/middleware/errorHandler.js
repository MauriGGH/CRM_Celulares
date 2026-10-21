/**
 * Handler de errores único. Responde siempre
 * { error: { code, message, details } }.
 */
const logger = require('../utils/logger');

const send = (res, status, code, message, details = {}) => res.status(status).json({ error: { code, message, details } });

module.exports = (err, req, res, _next) => {
  if (err.status && err.code && typeof err.code === 'string') {
    return send(res, err.status, err.code, err.message, err.details || {});
  }
  if (err.name === 'ValidationError') {
    const details = Object.fromEntries(Object.entries(err.errors || {}).map(([k, v]) => [k, v.message]));
    return send(res, 422, 'VALIDACION', 'Datos inválidos', details);
  }
  if (err.name === 'CastError') {
    return send(res, 422, 'VALIDACION', `${err.path} inválido`, { [err.path]: 'valor inválido' });
  }
  if (err.code === 11000) {
    return send(res, 409, 'DUPLICADO', 'Ya existe un registro con ese valor', err.keyValue || {});
  }
  if (err.type === 'entity.parse.failed') {
    return send(res, 400, 'JSON_INVALIDO', 'JSON inválido');
  }
  if (err.type === 'entity.too.large') {
    return send(res, 413, 'CUERPO_DEMASIADO_GRANDE', 'El cuerpo excede el tamaño permitido');
  }
  (req.log || logger).error({ err, path: req.path }, 'Error no controlado');
  send(res, 500, 'ERROR_INTERNO', 'Error interno del servidor');
};
