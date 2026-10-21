/**
 * Conexión compartida a Redis (colas BullMQ, caché y rate limit).
 * BullMQ exige maxRetriesPerRequest: null.
 */
const IORedis = require('ioredis');
const env = require('./env');

let connection;

function getRedis() {
  if (!connection) {
    connection = new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
}

module.exports = { getRedis };
