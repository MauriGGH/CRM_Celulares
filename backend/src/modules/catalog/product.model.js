const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { CONDICIONES, ESTADOS_PRODUCTO } = require('../../utils/constants');

/** Variante = SKU vendible (modelo + color + almacenamiento). Reemplaza a los modificadores. */
const VariantSchema = new Schema({
  sku: { type: String, required: true, trim: true, uppercase: true },
  color: { type: String, required: true, trim: true },
  almacenamiento_gb: { type: Number, required: true, min: 0 },
  ram_gb: { type: Number, min: 0 },
  precio: { type: Schema.Types.Decimal128, required: true },
  precio_antes: { type: Schema.Types.Decimal128 },
  costo: { type: Schema.Types.Decimal128 },
  gtin: { type: String, trim: true },
  // "marca|modelo|almacenamiento|color" normalizado; lo usa el empate de ingesta.
  match_key: { type: String },
  images: [String], // fotos propias de la variante (color)
  is_active: { type: Boolean, default: true },
}, schemaOptions());

const ProductSchema = new Schema({
  brand_id: { type: Schema.Types.ObjectId, ref: 'Brand', required: true },
  brand_nombre: { type: String, required: true }, // copia para búsqueda y empate de ingesta
  category_id: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  modelo: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true },
  descripcion: { type: String, default: '' },
  specs: { type: Schema.Types.Mixed, default: {} }, // pantalla, cámara, batería, red…
  condicion: { type: String, enum: CONDICIONES, default: 'nuevo' },
  garantia_meses: { type: Number, default: 12, min: 0 },
  estado: { type: String, enum: ESTADOS_PRODUCTO, default: 'borrador' },
  variants: [VariantSchema],
  images: [String], // URLs en orden de aparición
  origen: { type: String, enum: ['manual', 'ingesta', 'modelos'], default: 'manual' },
  modelo_ref: { type: String }, // ficha de `modelos` de la que salió
  ingest_record_id: { type: Schema.Types.ObjectId, ref: 'IngestRecord' },
}, schemaOptions());

ProductSchema.index({ 'variants.sku': 1 }, { unique: true });
ProductSchema.index(
  { 'variants.gtin': 1 },
  { unique: true, partialFilterExpression: { 'variants.gtin': { $type: 'string' } } },
);
ProductSchema.index({ estado: 1, brand_id: 1, category_id: 1 });
ProductSchema.index({ 'variants.match_key': 1 });
ProductSchema.index({ estado: 1, updated_at: 1 }); // sincronización incremental de la API externa
ProductSchema.index({ brand_id: 1, 'variants.almacenamiento_gb': 1 });
ProductSchema.index({ modelo: 'text', brand_nombre: 'text', descripcion: 'text' }, { default_language: 'spanish' });

module.exports = model('Product', ProductSchema, 'products');
