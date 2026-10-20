/**
 * Proceso worker (BullMQ). Corre en su propio contenedor con `npm run worker`.
 * Colas previstas:
 *   - ingest:        procesa lotes del scraper (B12)
 *   - reservations:  libera stock de pedidos sin pagar tras 15 min (B8)
 *   - emails:        confirmaciones de pedido y envío
 */
const { Worker } = require('bullmq');
const env = require('../config/env');
const logger = require('../utils/logger');
const { getRedis } = require('../config/redis');
const { connectDatabase } = require('../config/database');

async function main() {
  await connectDatabase(env.mongoUri);
  const connection = getRedis();

  new Worker('ingest', async (job) => {
    // TODO(backend B12): implementar en src/jobs/ingest.job.js
    logger.info({ batchId: job.data.batchId }, 'Lote de ingesta recibido (sin procesar aún)');
  }, { connection });

  logger.info('Worker listo');
}

main().catch((err) => {
  logger.error({ err }, 'El worker no pudo arrancar');
  process.exit(1);
});
