const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');

/**
 * Existencias de una variante en un almacén.
 *   disponible: unidades que se pueden vender ya.
 *   reservado:  unidades apartadas por checkouts pendientes de pago.
 * Al reservar: disponible -= n, reservado += n. Al pagar: reservado -= n.
 */
const StockLevelSchema = new Schema({
  sku: { type: String, required: true },
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  disponible: { type: Number, default: 0, min: 0 },
  reservado: { type: Number, default: 0, min: 0 },
  stock_minimo: { type: Number, default: 0, min: 0 },
}, schemaOptions());

StockLevelSchema.index({ sku: 1, warehouse_id: 1 }, { unique: true });

StockLevelSchema.index({ updated_at: 1 }); // sincronización incremental de la API externa

module.exports = model('StockLevel', StockLevelSchema, 'stock_levels');
