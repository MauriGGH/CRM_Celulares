const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');

/** Árbol de categorías: Celulares, Tablets, Accesorios › Fundas… */
const CategorySchema = new Schema({
  nombre: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true },
  parent_id: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
}, schemaOptions());

module.exports = model('Category', CategorySchema, 'categories');
