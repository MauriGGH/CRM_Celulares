const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { RECURSOS_EXPORT, FORMATOS_EXPORT } = require('../../utils/constants');

/**
 * Exportación masiva pedida por un sistema externo. El worker escribe el
 * archivo en GridFS (bucket `export_files`); el enlace firmado vence a las 24 h
 * y el barrido borra el archivo.
 */
const ExportJobSchema = new Schema({
  client_id: { type: Schema.Types.ObjectId, ref: 'ApiClient', required: true },
  resource: { type: String, enum: RECURSOS_EXPORT, required: true },
  format: { type: String, enum: FORMATOS_EXPORT, required: true },
  filters: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['en_cola', 'procesando', 'listo', 'fallido', 'vencido'], default: 'en_cola' },
  file_id: { type: Schema.Types.ObjectId, default: null },
  filename: String,
  rows: Number,
  bytes: Number,
  error: String,
  expires_at: { type: Date, required: true },
}, schemaOptions());

ExportJobSchema.index({ client_id: 1, created_at: -1 });
ExportJobSchema.index({ status: 1, expires_at: 1 });

module.exports = model('ExportJob', ExportJobSchema, 'export_jobs');
