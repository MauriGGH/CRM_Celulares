/**
 * Proceso worker (BullMQ). Corre en su propio contenedor con `npm run worker`.
 * Colas:
 *   - ingest:        procesa lotes del scraper (B12)
 *   - reservations:  libera stock de pedidos sin pagar tras 15 min (B8),
 *                    más un barrido cada minuto por si un job se pierde
 *   - emails:        confirmaciones de pedido y envío
 *   - exports:       exportaciones masivas de la API externa (B15)
 */
require('../utils/sentry').init('worker');
const { Worker, Queue } = require('bullmq');
const env = require('../config/env');
const logger = require('../utils/logger');
const { getRedis } = require('../config/redis');
const { connectDatabase } = require('../config/database');
const { QUEUES, handlers } = require('../utils/queue');
require('./handlers');

async function main() {
  if (!env.redisUrl) throw new Error('El worker necesita REDIS_URL');
  await connectDatabase(env.mongoUri);
  const connection = getRedis();

  const workers = QUEUES.map((queue) => {
    const w = new Worker(queue, async (job) => {
      const fn = handlers.get(`${queue}:${job.name}`);
      if (!fn) throw new Error(`Sin handler para ${queue}:${job.name}`);
      return fn(job.data);
    }, { connection, concurrency: queue === 'ingest' ? 1 : 5 });
    w.on('failed', (job, err) => logger.error({ err, queue, job: job?.name, id: job?.id }, 'job falló'));
    return w;
  });

  const reservations = new Queue('reservations', { connection });
  await reservations.upsertJobScheduler('sweep-expired', { every: 60_000 }, { name: 'sweep' });

  logger.info({ queues: QUEUES }, 'Worker listo');

  const stop = async () => {
    logger.info('Cerrando worker');
    await Promise.all(workers.map((w) => w.close()));
    await reservations.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  logger.error({ err }, 'El worker no pudo arrancar');
  process.exit(1);
});
