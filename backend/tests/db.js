/**
 * MongoDB en memoria para tests, en modo replica set (las transacciones lo exigen).
 * Sin internet para descargar mongod, apunta MONGOMS_SYSTEM_BINARY a un binario local.
 */
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let replSet;

async function startDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri());
}

async function stopDb() {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}

async function clearDb() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

module.exports = { startDb, stopDb, clearDb };
