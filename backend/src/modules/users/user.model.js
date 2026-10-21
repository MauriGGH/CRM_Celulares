const { Schema, model } = require('mongoose');
const { schemaOptions } = require('../../utils/schema');
const { ROLES } = require('../../utils/constants');

const AddressSchema = new Schema({
  nombre_destinatario: { type: String, required: true, trim: true },
  telefono: { type: String, trim: true },
  calle: { type: String, required: true, trim: true },
  numero: { type: String, trim: true },
  colonia: { type: String, trim: true },
  ciudad: { type: String, required: true, trim: true },
  estado: { type: String, required: true, trim: true },
  cp: { type: String, required: true, match: /^\d{5}$/ },
  referencias: { type: String, trim: true },
  es_principal: { type: Boolean, default: false },
}, schemaOptions());

/** Empleados y clientes comparten colección; `rol` decide los permisos. */
const UserSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash: { type: String, required: true },
  nombre: { type: String, required: true, trim: true },
  telefono: { type: String, trim: true },
  rol: { type: String, enum: ROLES, default: 'cliente', index: true },
  is_active: { type: Boolean, default: true },
  ultimo_login: Date,
  addresses: [AddressSchema],
}, schemaOptions());

module.exports = model('User', UserSchema, 'users');
