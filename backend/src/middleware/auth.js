/**
 * Middleware de autenticación JWT (staff y clientes).
 * Lee `Authorization: Bearer <token>`, verifica con JWT_SECRET y adjunta
 * el payload en `req.user` ({ id, rol, email, nombre }). Sin token o con
 * token inválido responde 401.
 */
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { unauthorized } = require('../utils/errors');

function readToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

/** @type {import('express').RequestHandler} */
function auth(req, res, next) {
  const token = readToken(req);
  if (!token) return next(unauthorized('Token requerido'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.typ !== 'access') return next(unauthorized('Token inválido o expirado'));
    req.user = { id: payload.sub, rol: payload.rol, email: payload.email, nombre: payload.nombre };
    next();
  } catch {
    next(unauthorized('Token inválido o expirado'));
  }
}

/** Igual que auth pero sin token deja pasar con req.user = null. */
auth.optional = (req, res, next) => {
  if (!readToken(req)) { req.user = null; return next(); }
  return auth(req, res, next);
};

module.exports = auth;
