const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');

/** Refresh token de clientes (se guarda solo el hash SHA-256). Rotación en cada uso. */
const RefreshTokenSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  token_hash: { type: String, required: true, unique: true },
  expires_at: { type: Date, required: true },
  revoked_at: Date,
  replaced_by: { type: Schema.Types.ObjectId, ref: 'RefreshToken' },
  user_agent: String,
}, schemaOptions());

// MongoDB borra los tokens vencidos solo.
RefreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

module.exports = model('RefreshToken', RefreshTokenSchema, 'refresh_tokens');
