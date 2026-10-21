/**
 * Atajos para lanzar AppError con los códigos más comunes.
 * Formato de respuesta: { error: { code, message, details } }.
 */
const AppError = require('./AppError');

const badRequest   = (msg, details) => new AppError(400, 'SOLICITUD_INVALIDA', msg, details);
const unauthorized = (msg = 'No autenticado') => new AppError(401, 'NO_AUTENTICADO', msg);
const forbidden    = (msg = 'Acceso denegado') => new AppError(403, 'ACCESO_DENEGADO', msg);
const notFound     = (what = 'Recurso') => new AppError(404, 'NO_ENCONTRADO', `${what} no encontrado`);
const conflict     = (code, msg, details) => new AppError(409, code, msg, details);
const unprocessable = (code, msg, details) => new AppError(422, code, msg, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable };
