/**
 * Autorización por rol. Se aplica después de auth.js.
 * Roles: admin, gerente, almacen, cliente. admin pasa siempre.
 */
const AppError = require('../utils/AppError');

const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new AppError(401, 'NO_AUTENTICADO', 'No autenticado'));
  if (req.user.rol !== 'admin' && !roles.includes(req.user.rol)) {
    return next(new AppError(403, 'ACCESO_DENEGADO', 'Acceso denegado'));
  }
  next();
};

module.exports = Object.assign(authorize, {
  requireGerente: authorize('gerente'),
  requireAlmacen: authorize('almacen', 'gerente'),
  requireCliente: authorize('cliente'),
});
