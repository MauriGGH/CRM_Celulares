/**
 * Conexión a MongoDB con Mongoose.
 * MongoDB corre como replica set (rs0) para poder usar transacciones
 * multi-documento en checkout, pagos y movimientos de inventario.
 * Compatible con MongoDB 4.4 (servidor en Raspberry Pi 4).
 */
const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

mongoose.set('strictQuery', true);

/** @param {string} uri */
async function connectDatabase(uri) {
  await mongoose.connect(uri, {
    dbName: env.mongoDbName,
    // En producción los índices los crea `npm run migrate` al desplegar.
    autoIndex: !env.isProd,
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info({ db: mongoose.connection.name }, 'Conexión a MongoDB establecida');
  return mongoose.connection;
}

async function disconnectDatabase() {
  await mongoose.disconnect();
}

module.exports = { connectDatabase, disconnectDatabase };
