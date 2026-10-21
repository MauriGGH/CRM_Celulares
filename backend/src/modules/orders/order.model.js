const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { CANALES, ESTADOS_PEDIDO, ESTADOS_ENVIO } = require('../../utils/constants');

/** Línea del pedido: precio, costo y descripción se copian al comprar. */
const OrderItemSchema = new Schema({
  sku: { type: String, required: true },
  nombre: String, // "Samsung Galaxy S25 256GB Negro"
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  warehouse_id: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  cantidad: { type: Number, required: true, min: 1 },
  precio_unitario: { type: Schema.Types.Decimal128, required: true },
  descuento: { type: Schema.Types.Decimal128, default: '0.00' },
  subtotal: { type: Schema.Types.Decimal128, required: true },
  costo_unitario: { type: Schema.Types.Decimal128, default: '0.00' },
  imeis: [String], // IMEI asignados al pagar o al preparar
}, { _id: true });

const ShipmentSchema = new Schema({
  paqueteria: { type: String, required: true },
  guia: { type: String, required: true },
  estado: { type: String, enum: ESTADOS_ENVIO, default: 'enviado' },
  enviado_en: Date,
  entregado_en: Date,
}, { _id: false });

const StatusHistorySchema = new Schema({
  estado: String,
  at: { type: Date, default: Date.now },
  user_id: { type: Schema.Types.ObjectId, ref: 'User' },
  nota: String,
}, { _id: false });

/**
 * Pedido en línea.
 * Estados: pendiente_pago → pagado → preparando → enviado → entregado,
 * o cancelado / reembolsado.
 */
const OrderSchema = new Schema({
  folio: { type: String, required: true, unique: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  canal: { type: String, enum: CANALES, required: true },
  estado: { type: String, enum: ESTADOS_PEDIDO, default: 'pendiente_pago' },
  items: { type: [OrderItemSchema], validate: (v) => v.length > 0 },
  subtotal: { type: Schema.Types.Decimal128, required: true },
  descuento: { type: Schema.Types.Decimal128, default: '0.00' },
  envio: { type: Schema.Types.Decimal128, default: '0.00' },
  total: { type: Schema.Types.Decimal128, required: true },
  moneda: { type: String, default: 'MXN' },
  promotion_id: { type: Schema.Types.ObjectId, ref: 'Promotion', default: null },
  shipping_address: { type: Schema.Types.Mixed, default: null }, // copia de la dirección
  reservado_hasta: Date,
  notas: String,
  motivo_cancelacion: String,
  pagado_en: Date,
  cancelado_en: Date,
  entregado_en: Date,
  shipment: { type: ShipmentSchema, default: null },
  status_history: [StatusHistorySchema],
}, schemaOptions());

OrderSchema.index({ estado: 1, created_at: -1 });
OrderSchema.index({ user_id: 1, created_at: -1 });
OrderSchema.index({ estado: 1, reservado_hasta: 1 });
OrderSchema.index({ created_at: -1 });

module.exports = model('Order', OrderSchema, 'orders');
