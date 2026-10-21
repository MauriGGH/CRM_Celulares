const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { RESULTADOS_INGESTA, DECISIONES_INGESTA } = require('../../utils/constants');

/**
 * Un registro del lote y su resultado de empate. Los `nuevo` y `conflicto`
 * quedan `pendiente` en la cola de revisión del gerente.
 */
const IngestRecordSchema = new Schema({
  batch_id: { type: Schema.Types.ObjectId, ref: 'IngestBatch', required: true, index: true },
  source: { type: String, required: true },
  external_id: String,
  source_url: String,
  payload: { type: Schema.Types.Mixed, required: true },
  resultado: { type: String, enum: [...RESULTADOS_INGESTA, null], default: null },
  motivo: String,
  sku: { type: String, default: null }, // SKU empatado o sugerido
  product_id: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  similitud: Number,
  decision: { type: String, enum: [...DECISIONES_INGESTA, null], default: null },
  revisado_por: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  revisado_en: Date,
  nota_revision: String,
  product_creado_id: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
}, schemaOptions());

IngestRecordSchema.index({ resultado: 1, decision: 1, created_at: -1 });
IngestRecordSchema.index({ source: 1, external_id: 1 });

module.exports = model('IngestRecord', IngestRecordSchema, 'ingest_records');
