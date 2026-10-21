/**
 * Registro de los procesadores de cada cola. Lo cargan app.js (modo inline)
 * y el worker (BullMQ).
 */
const { registerHandler } = require('../utils/queue');
const orders = require('../modules/orders/order.service');
const ingest = require('../modules/ingest/ingest.service');
const exportsSvc = require('../modules/external/export.service');

registerHandler('reservations', 'expire', ({ orderId }) => orders.expireReservation(orderId));
registerHandler('reservations', 'sweep', async () => {
  await orders.sweepExpired();
  await exportsSvc.sweepExpired();
});
registerHandler('ingest', 'process', ({ batchId }) => ingest.processBatch(batchId));
registerHandler('emails', 'order-confirmed', ({ orderId }) => orders.emailFor(orderId, 'confirmed'));
registerHandler('emails', 'order-shipped', ({ orderId }) => orders.emailFor(orderId, 'shipped'));
registerHandler('exports', 'generate', ({ exportId }) => exportsSvc.generate(exportId));
