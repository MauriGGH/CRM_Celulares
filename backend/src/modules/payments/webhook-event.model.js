const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');

/** Evento de webhook ya recibido; evita procesar dos veces el mismo aviso. */
const WebhookEventSchema = new Schema({
  proveedor: { type: String, required: true },
  event_id: { type: String, required: true },
  payload: Schema.Types.Mixed,
  procesado_en: Date,
}, schemaOptions());

WebhookEventSchema.index({ proveedor: 1, event_id: 1 }, { unique: true });

module.exports = model('WebhookEvent', WebhookEventSchema, 'webhook_events');
