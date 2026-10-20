/**
 * Lee y valida las variables de entorno una sola vez.
 * El resto del código importa `env` en lugar de leer process.env directamente.
 */
require('dotenv').config();

const required = ['MONGO_URI', 'JWT_SECRET'];
if (process.env.NODE_ENV !== 'test') {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3001,
  mongoUri: process.env.MONGO_URI,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  ingestServiceToken: process.env.INGEST_SERVICE_TOKEN,
};
