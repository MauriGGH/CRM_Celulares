const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { TIPOS_ALMACEN } = require('../../utils/constants');

/** Almacén de donde salen los envíos. Normalmente uno; permite crecer a varios. */
const WarehouseSchema = new Schema({
  nombre: { type: String, required: true, unique: true, trim: true },
  tipo: { type: String, enum: TIPOS_ALMACEN, default: 'almacen' },
  direccion: String,
  is_active: { type: Boolean, default: true },
}, schemaOptions());

module.exports = model('Warehouse', WarehouseSchema, 'warehouses');
