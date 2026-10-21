/**
 * Conexión compartida a Redis (colas BullMQ, caché y rate limit).
 * BullMQ exige maxRetriesPerRequest: null. Sin REDIS_URL (tests) devuelve null
 * y el rate limit cae a memoria.
 */
const IORedis = require('ioredis');
const env = require('./env');

let connection;

function getRedis() {
  if (!env.redisUrl) return null;
  if (!connection) {
    connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
}

async function closeRedis() {
  if (connection) { await connection.quit(); connection = null; }
}

module.exports = { getRedis, closeRedis };
