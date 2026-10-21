/**
 * Corre una lista de reglas de express-validator y responde 422 con
 * `{ error: { code: 'VALIDACION', details: { campo: mensaje } } }`
 * si alguna falla.
 *
 * Uso: router.post('/x', validate([body('email').isEmail()]), handler)
 */
const { validationResult } = require('express-validator');
const AppError = require('../utils/AppError');

/**
 * @param {import('express-validator').ValidationChain[]} rules
 * @returns {import('express').RequestHandler}
 */
module.exports = function validate(rules) {
  return async (req, res, next) => {
    for (const rule of rules) await rule.run(req);
    const result = validationResult(req);
    if (result.isEmpty()) return next();
    const details = {};
    for (const e of result.array()) {
      const field = e.path || e.param || '_';
      if (!details[field]) details[field] = e.msg;
    }
    next(new AppError(422, 'VALIDACION', 'Datos inválidos', details));
  };
};
