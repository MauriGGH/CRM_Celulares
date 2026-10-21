/**
 * MongoDB para tests, en modo replica set (las transacciones lo exigen).
 * - Por defecto: mongodb-memory-server con MongoDB 4.4.18, la misma versión
 *   que producción (Raspberry Pi 4). Cambia con MONGOMS_VERSION; sin internet,
 *   apunta MONGOMS_SYSTEM_BINARY a un mongod local.
 * - Con MONGO_URI_TEST usa un replica set existente, p. ej.
 *   MONGO_URI_TEST=mongodb://localhost:27017/?replicaSet=rs0&directConnection=true
 *   Cada archivo de tests usa su propia base y la borra al terminar.
 */
const mongoose = require('mongoose');
const path = require('path');

let replSet;

async function startDb() {
  const file = path.basename(expect.getState().testPath || 'test', '.test.js').replace(/\W/g, '_');
  const dbName = `test_${file}_${process.pid}`;
  if (process.env.MONGO_URI_TEST) {
    await mongoose.connect(process.env.MONGO_URI_TEST, { dbName });
  } else {
    const { MongoMemoryReplSet } = require('mongodb-memory-server');
    replSet = await MongoMemoryReplSet.create({
      binary: process.env.MONGOMS_SYSTEM_BINARY ? {} : { version: process.env.MONGOMS_VERSION || '4.4.18' },
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(replSet.getUri(), { dbName });
  }
  // MongoDB 4.4 no crea colecciones dentro de una transacción: se crean antes.
  require('../src/utils/models');
  for (const m of Object.values(mongoose.models)) {
    await m.createCollection().catch(() => {});
    await m.syncIndexes();
  }
}

async function stopDb() {
  const { drain } = require('../src/utils/queue');
  await drain();
  if (process.env.MONGO_URI_TEST && mongoose.connection.db) await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

async function clearDb() {
  const { drain } = require('../src/utils/queue');
  await drain();
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  require('../src/middleware/rateLimit')._stamps.clear();
}

module.exports = { startDb, stopDb, clearDb };
