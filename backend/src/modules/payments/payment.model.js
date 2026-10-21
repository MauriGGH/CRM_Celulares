const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { PROVEEDORES_PAGO, ESTADOS_PAGO } = require('../../utils/constants');

/** Intento de pago de un pedido (puede haber varios). */
const PaymentSchema = new Schema({
  order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  proveedor: { type: String, enum: PROVEEDORES_PAGO, required: true },
  referencia_externa: String,
  estado: { type: String, enum: ESTADOS_PAGO, default: 'pendiente' },
  monto: { type: Schema.Types.Decimal128, required: true },
  moneda: { type: String, default: 'MXN' },
  respuesta: { type: Schema.Types.Mixed, default: {} },
}, schemaOptions());

PaymentSchema.index(
  { proveedor: 1, referencia_externa: 1 },
  { unique: true, partialFilterExpression: { referencia_externa: { $type: 'string' } } },
);

module.exports = model('Payment', PaymentSchema, 'payments');
