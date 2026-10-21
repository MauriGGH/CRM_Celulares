const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { SCOPES_EXTERNOS } = require('../../utils/constants');

/**
 * Sistema externo con acceso de solo lectura a /external/v1 (B15).
 * Solo se guarda el HMAC de la llave; la llave completa se muestra una vez.
 */
const ApiClientSchema = new Schema({
  nombre: { type: String, required: true, trim: true },
  prefix: { type: String, required: true, unique: true }, // visible: ck_<prefix>_…
  key_hash: { type: String, required: true, select: false },
  scopes: { type: [{ type: String, enum: SCOPES_EXTERNOS }], required: true },
  limite_por_minuto: { type: Number, default: 60, min: 1, max: 1000 },
  vence_en: { type: Date, default: null },
  activo: { type: Boolean, default: true },
  ultimo_uso_en: { type: Date, default: null },
  creado_por: { type: Schema.Types.ObjectId, ref: 'User' },
}, schemaOptions());

module.exports = model('ApiClient', ApiClientSchema, 'api_clients');
