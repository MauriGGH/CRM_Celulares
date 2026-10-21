const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { TIPOS_DESCUENTO } = require('../../utils/constants');

/**
 * Promoción automática (sin `codigo`) o cupón (con `codigo`).
 * La aplica utils/promociones.js; regla: máximo una por pedido.
 */
const PromotionSchema = new Schema({
  nombre: { type: String, required: true, trim: true },
  descripcion: String,
  codigo: { type: String, trim: true, uppercase: true },
  tipo_descuento: { type: String, enum: TIPOS_DESCUENTO, required: true },
  valor_descuento: { type: Number, min: 0 }, // % para Porcentaje; pesos para Monto fijo/Combo; Y para Lleva X paga Y
  cantidad_minima: { type: Number, min: 0 },
  aplicacion: { type: String, enum: ['producto', 'total'], default: 'producto' },
  requiere_todos_productos: { type: Boolean, default: false },
  dias_semana: { type: String, default: '' }, // "0,1,2" (0 = lunes); vacío = todos
  fecha_inicio: { type: Date, required: true },
  fecha_fin: { type: Date, required: true },
  activa: { type: Boolean, default: true },
  orden: { type: Number, default: 0 },
  imagen_url: String,
  productos_aplicables: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
  productos_beneficiados: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
  usos_maximos: { type: Number, default: null },
  usos: { type: Number, default: 0 },
}, schemaOptions());

PromotionSchema.index({ codigo: 1 }, { unique: true, partialFilterExpression: { codigo: { $type: 'string' } } });
PromotionSchema.index({ activa: 1, fecha_inicio: 1, fecha_fin: 1 });

module.exports = model('Promotion', PromotionSchema, 'promotions');
