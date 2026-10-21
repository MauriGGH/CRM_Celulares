/**
 * Colas de trabajo (BullMQ sobre Redis).
 *   reservations: libera reservas de stock vencidas.
 *   ingest:       procesa lotes del scraper.
 *   emails:       correos de pedido y envío.
 *   exports:      exportaciones masivas de la API externa (B15).
 *
 * QUEUE_MODE=inline (tests o dev sin Redis) ejecuta el handler en el mismo
 * proceso, en segundo plano; `drain()` espera a que terminen (tests). Los
 * jobs con `delay` se omiten: el barrido periódico del worker los cubre.
 */
const config = require('../config/env');
const { getRedis } = require('../config/redis');
const logger = require('./logger');

const QUEUES = ['reservations', 'ingest', 'emails', 'exports'];
const handlers = new Map(); // `${queue}:${name}` → fn(data)
const queues = new Map();
const pending = new Set();

/**
 * Registra el procesador de un job (lo usan worker.js y el modo inline).
 * @param {string} queue
 * @param {string} name
 * @param {(data:any) => Promise<any>} fn
 */
function registerHandler(queue, name, fn) {
  handlers.set(`${queue}:${name}`, fn);
}

function getQueue(name) {
  if (!queues.has(name)) {
    const { Queue } = require('bullmq');
    queues.set(name, new Queue(name, { connection: getRedis() }));
  }
  return queues.get(name);
}

/**
 * Encola un job.
 * @param {string} queue
 * @param {string} name
 * @param {object} data
 * @param {import('bullmq').JobsOptions} [opts]
 */
async function enqueue(queue, name, data, opts = {}) {
  if (config.queueMode === 'inline') {
    if (opts.delay) return null;
    const fn = handlers.get(`${queue}:${name}`);
    if (!fn) { logger.warn({ queue, name }, 'job sin handler (inline)'); return null; }
    const p = Promise.resolve()
      .then(() => fn(data))
      .catch((err) => logger.error({ err, queue, name }, 'job inline falló'))
      .finally(() => pending.delete(p));
    pending.add(p);
    return null;
  }
  return getQueue(queue).add(name, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
    ...opts,
  });
}

/** Espera los jobs inline en curso (y los que estos encolen). */
async function drain() {
  while (pending.size) await Promise.all([...pending]);
}

async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}

module.exports = { QUEUES, enqueue, registerHandler, handlers, drain, closeQueues };
