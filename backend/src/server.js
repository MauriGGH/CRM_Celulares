/**
 * Punto de entrada: conecta a MongoDB y arranca Express.
 * Los índices se crean con `npm run migrate` al desplegar (en desarrollo
 * también con autoIndex).
 */
const env = require('./config/env');
const app = require('./app');
const logger = require('./utils/logger');
const { connectDatabase } = require('./config/database');

connectDatabase(env.mongoUri)
  .then(() => {
    const server = app.listen(env.port, () => logger.info(`API escuchando en el puerto ${env.port}`));
    const stop = () => server.close(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  })
  .catch((err) => {
    logger.error({ err }, 'No se pudo conectar a MongoDB');
    process.exit(1);
  });
