/**
 * Convierte documentos Mongoose / objetos lean al formato de la API:
 *   _id → id (string), se quitan __v y campos secretos,
 *   ObjectId → string, Decimal128 → texto decimal ("18999.00").
 */
const { formatMoney } = require('./money');

const HIDDEN = new Set(['__v', 'password_hash', 'token_hash', 'request_hash']);

/**
 * @param {*} value
 * @returns {*}
 */
function serialize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value !== 'object') return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID') return value.toString();
  if (value._bsontype === 'Decimal128') return formatMoney(value.toString());
  if (typeof value.toObject === 'function') value = value.toObject({ virtuals: false, transform: false });

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (HIDDEN.has(k)) continue;
    if (k === '_id') { out.id = serialize(v); continue; }
    out[k] = serialize(v);
  }
  return out;
}

module.exports = serialize;
