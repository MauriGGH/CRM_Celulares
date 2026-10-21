const { Schema, model } = require('mongoose');
const { toJSON } = require('../../utils/schema').schemaOptions();

/** Bitácora de acciones (cambios de precio, estados de pedido, usuarios…). */
const AuditLogSchema = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  accion: { type: String, required: true },
  entidad: String,
  entidad_id: String,
  antes: Schema.Types.Mixed,
  despues: Schema.Types.Mixed,
  detalle: { type: Schema.Types.Mixed, default: {} },
  ip: String,
}, { timestamps: { createdAt: 'created_at', updatedAt: false }, toJSON });

AuditLogSchema.index({ created_at: -1 });
AuditLogSchema.index({ accion: 1, created_at: -1 });
AuditLogSchema.index({ entidad: 1, entidad_id: 1 });

module.exports = model('AuditLog', AuditLogSchema, 'audit_logs');
