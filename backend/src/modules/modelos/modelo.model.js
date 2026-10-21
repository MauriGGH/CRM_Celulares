const { Schema, model } = require('mongoose');

/**
 * Ficha técnica de un modelo de celular (colección `modelos`, la llena el
 * equipo de datos a partir de GSMArena). El backend solo la lee: sirve para
 * crear productos en borrador con sus specs e imagen.
 *
 * `strict: false` porque el equipo de datos puede agregar campos; sin
 * índices propios para que `npm run migrate` no toque los de ese equipo.
 * `precio` es texto de referencia en USD ("$899 USD"), nunca precio de venta.
 */
const ModeloSchema = new Schema({
  id: Number,
  marca: String,
  modelo: String,
  almacenamiento: String, // "128GB / 256GB / 1TB"
  memoria_ram: String,    // "8GB" o "8GB / 12GB"
  procesador: String,
  pantalla: String,
  medidas: String,
  bateria: String,
  camara_principal: String,
  sistema_operativo: String,
  precio: String,
  imagen: String,
  url_gsmarena: String,
}, { strict: false, autoIndex: false, versionKey: false });

module.exports = model('Modelo', ModeloSchema, 'modelos');
