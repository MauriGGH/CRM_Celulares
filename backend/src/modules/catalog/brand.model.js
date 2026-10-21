const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');

const BrandSchema = new Schema({
  nombre: { type: String, required: true, unique: true, trim: true },
  slug: { type: String, required: true, unique: true },
  logo_url: String,
}, schemaOptions());

module.exports = model('Brand', BrandSchema, 'brands');
