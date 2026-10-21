/**
 * Conexión a MongoDB con Mongoose.
 * MongoDB corre como replica set (rs0) para poder usar transacciones
 * multi-documento en checkout y movimientos de inventario.
 */
const mongoose = require('mongoose');
const logger = require('../utils/logger');

mongoose.set('strictQuery', true);

/** @param {string} uri */
async function connectDatabase(uri) {
  await mongoose.connect(uri);
  logger.info({ db: mongoose.connection.name }, 'Conexión a MongoDB establecida');
  return mongoose.connection;
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

module.exports = { connectDatabase, disconnectDatabase };
