/**
 * Autenticación JWT (staff y clientes).
 * Lee `Authorization: Bearer <token>`, lo verifica y deja el payload en req.user
 * ({ sub, rol }). Portado de mochi-matcha-react/backend/src/middleware/auth.js.
 */
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../utils/AppError');

module.exports = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError(401, 'TOKEN_REQUERIDO', 'Token requerido'));
  }
  try {
    req.user = jwt.verify(header.slice(7), env.jwtSecret);
    next();
  } catch {
    next(new AppError(401, 'TOKEN_INVALIDO', 'Token inválido o expirado'));
  }
};
