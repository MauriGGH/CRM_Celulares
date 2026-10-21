const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { TIPOS_DEVOLUCION, ESTADOS_DEVOLUCION } = require('../../utils/constants');

/** Devolución o garantía sobre una línea de pedido. */
const ReturnSchema = new Schema({
  order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  order_item_id: { type: Schema.Types.ObjectId, required: true },
  sku: { type: String, required: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User' },
  cantidad: { type: Number, default: 1, min: 1 },
  motivo: { type: String, required: true },
  tipo: { type: String, enum: TIPOS_DEVOLUCION, required: true },
  estado: { type: String, enum: ESTADOS_DEVOLUCION, default: 'solicitada' },
  imei: { type: String, default: null },
  resolucion: String,
  reintegrar_stock: { type: Boolean, default: true },
}, schemaOptions());

ReturnSchema.index({ estado: 1, created_at: -1 });

module.exports = model('Return', ReturnSchema, 'returns');
