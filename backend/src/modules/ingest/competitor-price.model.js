const { Schema, model } = require('mongoose');

/**
 * Histórico de precios de la competencia por SKU.
 * Solo lectura para ventas: la ingesta nunca cambia precios propios.
 * Colección normal (no time series) porque el servidor de producción es
 * MongoDB 4.4 (Raspberry Pi 4); `meta` deja listo el paso a time series.
 */
const CompetitorPriceSchema = new Schema({
  captured_at: { type: Date, required: true },
  meta: {
    sku: { type: String, required: true },
    source: { type: String, required: true },
  },
  product_id: { type: Schema.Types.ObjectId, ref: 'Product' },
  precio: { type: Schema.Types.Decimal128, required: true },
  en_stock: Boolean,
  url: String,
  ingest_record_id: { type: Schema.Types.ObjectId, ref: 'IngestRecord' },
}, { versionKey: false });

CompetitorPriceSchema.index({ 'meta.sku': 1, captured_at: -1 });
CompetitorPriceSchema.index({ 'meta.source': 1, captured_at: -1 });

module.exports = model('CompetitorPrice', CompetitorPriceSchema, 'competitor_prices');
