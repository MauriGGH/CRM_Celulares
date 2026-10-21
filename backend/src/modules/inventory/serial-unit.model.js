const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { ESTADOS_SERIAL } = require('../../utils/constants');

/** Teléfono físico rastreado por IMEI (garantías y devoluciones). */
const SerialUnitSchema = new Schema({
  imei: { type: String, required: true, unique: true, match: /^\d{15}$/ },
  sku: { type: String, required: true, index: true },
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  estado: { type: String, enum: ESTADOS_SERIAL, default: 'disponible' },
  order_id: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  order_item_id: { type: Schema.Types.ObjectId, default: null },
  notas: String,
}, schemaOptions());

SerialUnitSchema.index({ sku: 1, warehouse_id: 1, estado: 1 });

module.exports = model('SerialUnit', SerialUnitSchema, 'serial_units');
