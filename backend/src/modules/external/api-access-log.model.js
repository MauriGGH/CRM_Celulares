const { Schema, model } = require('mongoose');

/** Una fila por llamada a /external/v1. Se borra sola a los 90 días. */
const ApiAccessLogSchema = new Schema({
  client_id: { type: Schema.Types.ObjectId, ref: 'ApiClient' },
  method: String,
  path: String,
  status: Number,
  duracion_ms: Number,
  ip: String,
  created_at: { type: Date, default: Date.now },
}, { versionKey: false });

ApiAccessLogSchema.index({ client_id: 1, created_at: -1 });
ApiAccessLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 90 * 86_400 });

module.exports = model('ApiAccessLog', ApiAccessLogSchema, 'api_access_logs');
