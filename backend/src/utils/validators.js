/**
 * Reglas reutilizables de express-validator.
 */
const { body, param, query } = require('express-validator');
const { isMoney } = require('./money');

const objectIdParam = (name = 'id') => param(name).isMongoId().withMessage('id inválido');
const money = (field) => body(field).custom((v) => isMoney(v)).withMessage('monto inválido (ej. "18999.00")');
const optionalMoney = (field) => body(field).optional({ values: 'null' }).custom((v) => isMoney(v)).withMessage('monto inválido (ej. "18999.00")');
const pageQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('page debe ser entero ≥ 1'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit entre 1 y 100'),
];

module.exports = { objectIdParam, money, optionalMoney, pageQuery, body, param, query };
