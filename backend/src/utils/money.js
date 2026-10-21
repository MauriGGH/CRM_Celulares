/**
 * Dinero: se guarda como Decimal128 en MongoDB y viaja en JSON como texto
 * decimal ("18999.00"). Las cuentas se hacen en centavos enteros para no
 * perder precisión.
 */
const { Types } = require('mongoose');

/**
 * @param {string|number|import('mongoose').Types.Decimal128|null} value
 * @returns {number|null} centavos enteros
 */
function toCents(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,2})\d*)?$/.exec(s);
  if (!m) {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new TypeError(`Monto inválido: ${value}`);
    return Math.round(n * 100);
  }
  const cents = parseInt(m[2], 10) * 100 + parseInt((m[3] || '').padEnd(2, '0'), 10);
  return m[1] ? -cents : cents;
}

/**
 * @param {number|null} cents
 * @returns {string|null} "18999.00"
 */
function fromCents(cents) {
  if (cents === null || cents === undefined) return null;
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** @param {number} cents @returns {Types.Decimal128} */
const toDecimal = (cents) => Types.Decimal128.fromString(fromCents(cents));

/** Normaliza cualquier monto (Decimal128, número, texto) a "0.00". */
const formatMoney = (value) => fromCents(toCents(value));

const isMoney = (v) => v !== null && v !== undefined && /^\d{1,10}(\.\d{1,2})?$/.test(String(v).trim());

module.exports = { toCents, fromCents, toDecimal, formatMoney, isMoney };
