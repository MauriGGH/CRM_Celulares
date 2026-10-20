/**
 * Punto de entrada: conecta a MongoDB y arranca Express.
 * El esquema lo definen los modelos de Mongoose; los índices se crean con
 * `npm run seed` o al arrancar en desarrollo (autoIndex).
 */
const env = require('./config/env');
const app = require('./app');
const logger = require('./utils/logger');
const { connectDatabase } = require('./config/database');

connectDatabase(env.mongoUri)
  .then(() => {
    app.listen(env.port, () => logger.info(`API escuchando en el puerto ${env.port}`));
  })
  .catch((err) => {
    logger.error({ err }, 'No se pudo conectar a MongoDB');
    process.exit(1);
  });
