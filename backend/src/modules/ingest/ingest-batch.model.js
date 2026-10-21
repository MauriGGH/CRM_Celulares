/**
 * Colección ingest_batches: un lote enviado por el scraper.
 * El worker (B12) lo procesa y llena ingest_records y competitor_prices.
 */
const { Schema, model } = require('mongoose');

const ingestBatchSchema = new Schema(
  {
    source: { type: String, required: true, index: true },
    schema_version: { type: String, required: true },
    scraped_at: { type: Date, required: true },
    idempotency_key: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['en_cola', 'procesando', 'listo', 'fallido'],
      default: 'en_cola',
      index: true,
    },
    record_count: { type: Number, required: true },
    // Los registros quedan aquí hasta que el worker los procese.
    records: { type: [Schema.Types.Mixed], select: false },
    stats: {
      coincide: { type: Number, default: 0 },
      nuevo: { type: Number, default: 0 },
      conflicto: { type: Number, default: 0 },
      invalido: { type: Number, default: 0 },
    },
    processed_at: Date,
    error: String,
  },
  { collection: 'ingest_batches', timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

module.exports = model('IngestBatch', ingestBatchSchema);
