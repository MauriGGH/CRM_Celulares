const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');

const CartItemSchema = new Schema({
  sku: { type: String, required: true },
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  cantidad: { type: Number, required: true, min: 1 },
}, { _id: true });

/** Carrito persistente: uno por cliente, con el cupón capturado. */
const CartSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  items: [CartItemSchema],
  coupon_code: { type: String, default: null },
}, schemaOptions());

module.exports = model('Cart', CartSchema, 'carts');
