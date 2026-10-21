const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');

/** Configuración clave/valor (costo de envío, almacén online, modo mantenimiento…). */
const SettingSchema = new Schema({
  clave: { type: String, required: true, unique: true },
  valor: { type: Schema.Types.Mixed },
  descripcion: String,
}, schemaOptions());

module.exports = model('Setting', SettingSchema, 'settings');
