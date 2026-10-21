const mongoose = require('mongoose');
const { badRequest } = require('./errors');

/**
 * Valida y convierte un id de ruta a ObjectId; lanza 400 si no es válido.
 * @param {string} id
 * @param {string} [name]
 */
function oid(id, name = 'id') {
  if (!mongoose.isValidObjectId(id)) throw badRequest(`${name} inválido`);
  return new mongoose.Types.ObjectId(String(id));
}

module.exports = { oid };
