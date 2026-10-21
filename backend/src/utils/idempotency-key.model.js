const { Schema, model } = require('mongoose');

/** Respuesta guardada para un Idempotency-Key (24 h). */
const IdempotencyKeySchema = new Schema({
  scope: { type: String, required: true },
  key: { type: String, required: true },
  request_hash: { type: String, required: true },
  status_code: Number,
  response_body: Schema.Types.Mixed,
  created_at: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
});

IdempotencyKeySchema.index({ scope: 1, key: 1 }, { unique: true });

module.exports = model('IdempotencyKey', IdempotencyKeySchema, 'idempotency_keys');
