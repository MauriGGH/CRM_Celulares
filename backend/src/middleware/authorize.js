/**
 * Middleware de autorización por rol.
 * Se aplica DESPUÉS de auth.js (que puebla req.user). Si el rol del usuario
 * no está en la whitelist responde 403. Admin siempre pasa.
 */
const { unauthorized, forbidden } = require('../utils/errors');

/**
 * Crea un middleware que sólo permite pasar a los roles indicados.
 * @param {...string} roles roles permitidos (ej. 'gerente', 'almacen')
 * @returns {import('express').RequestHandler}
 */
const authorize = (...roles) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (req.user.rol !== 'admin' && !roles.includes(req.user.rol)) return next(forbidden());
  next();
};

const requireCliente  = authorize('cliente');
const requireAlmacen  = authorize('almacen', 'gerente');
const requireGerente  = authorize('gerente');
const requireAdmin    = authorize();

module.exports = Object.assign(authorize, {
  requireCliente, requireAlmacen, requireGerente, requireAdmin,
});
