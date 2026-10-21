/**
 * Envuelve un handler async para mandar los errores a next().
 * @param {import('express').RequestHandler} fn
 */
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
