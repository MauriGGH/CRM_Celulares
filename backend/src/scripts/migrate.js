/**
 * `npm run migrate`: crea las colecciones e índices de todos los modelos
 * (syncIndexes también borra índices que ya no existen en el esquema).
 * El deploy lo corre antes de levantar la nueva versión.
 */
const env = require('../config/env');
const logger = require('../utils/logger');
const { connectDatabase, disconnectDatabase } = require('../config/database');
const models = require('../utils/models');

async function main() {
  await connectDatabase(env.mongoUri);
  for (const [name, Model] of Object.entries(models)) {
    await Model.createCollection().catch((err) => { if (err.codeName !== 'NamespaceExists') throw err; });
    // `modelos` es del equipo de datos: syncIndexes borraría sus índices.
    if (Model.schema.get('autoIndex') === false) continue;
    const dropped = await Model.syncIndexes();
    logger.info({ model: name, dropped }, 'índices sincronizados');
  }
  await disconnectDatabase();
}

main().catch((err) => {
  logger.error({ err }, 'migrate falló');
  process.exit(1);
});
