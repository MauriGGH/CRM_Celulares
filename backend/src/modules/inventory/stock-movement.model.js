const { Schema, model } = require('mongoose');
const { TIPOS_MOVIMIENTO } = require('../../utils/constants');
const { toJSON } = require('../../utils/schema').schemaOptions();

/** Bitácora inmutable del inventario. `cantidad` lleva signo (+ entra, − sale). */
const StockMovementSchema = new Schema({
  sku: { type: String, required: true },
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  tipo: { type: String, enum: TIPOS_MOVIMIENTO, required: true },
  cantidad: { type: Number, required: true },
  referencia: String,
  user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  serial_unit_id: { type: Schema.Types.ObjectId, ref: 'SerialUnit', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

StockMovementSchema.index({ sku: 1, created_at: -1 });
StockMovementSchema.index({ warehouse_id: 1, created_at: -1 });

module.exports = model('StockMovement', StockMovementSchema, 'stock_movements');
