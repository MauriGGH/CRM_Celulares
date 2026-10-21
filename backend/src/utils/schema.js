/**
 * Opciones comunes de schema: created_at/updated_at en UTC y salida JSON
 * en el formato de la API (ver lib/serialize.js).
 */
const serialize = require('./serialize');

const timestamps = { createdAt: 'created_at', updatedAt: 'updated_at' };
const toJSON = { transform: (_doc, ret) => serialize(ret) };

/** @param {object} [extra] */
const schemaOptions = (extra = {}) => ({ timestamps, toJSON, ...extra });

module.exports = { schemaOptions, timestamps };
