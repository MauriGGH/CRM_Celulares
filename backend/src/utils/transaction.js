/**
 * withTransaction(fn): corre `fn(session)` dentro de una transacción de
 * MongoDB con reintentos automáticos ante conflictos transitorios.
 * Requiere replica set (ver config/database.js).
 */
const mongoose = require('mongoose');

/**
 * @template T
 * @param {(session: import('mongoose').ClientSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { withTransaction };
