/**
 * Pagos con interfaz común por proveedor:
 *   createPayment(order, urls) → { approve_url, referencia_externa? }
 *   capturePayment({ referencia }) → resultado normalizado
 *   verifyWebhook(req) / parseWebhook(req)
 *
 * `confirm()` es el único lugar que marca un pedido como pagado y es
 * idempotente por (proveedor, referencia_externa): un webhook repetido o una
 * captura doble no descuentan stock dos veces.
 */
const Payment = require('./payment.model');
const WebhookEvent = require('./webhook-event.model');
const orders = require('../orders/order.service');
const env = require('../../config/env');
const { withTransaction } = require('../../utils/transaction');
const { toDecimal, toCents } = require('../../utils/money');
const { enqueue } = require('../../utils/queue');
const { logAccion } = require('../../utils/auditoria');
const { notFound, conflict, unauthorized, badRequest } = require('../../utils/errors');
const logger = require('../../utils/logger');

const providers = {
  mercadopago: require('./providers/mercadopago'),
  paypal: require('./providers/paypal'),
};

function provider(name) {
  const p = providers[name];
  if (!p) throw notFound('Proveedor de pago');
  return p;
}

/** Permite sustituir un proveedor (tests con respuestas simuladas). */
function setProvider(name, impl) { providers[name] = impl; }

/** Crea el intento de pago y devuelve la URL a la que se redirige al cliente. */
async function create(user, providerName, orderId) {
  const p = provider(providerName);
  const order = await orders.getPayable(user, orderId);
  const urls = {
    returnUrl: `${env.publicUrl}/checkout/resultado?pedido=${order._id}&proveedor=${providerName}`,
    cancelUrl: `${env.publicUrl}/checkout/resultado?pedido=${order._id}&proveedor=${providerName}&cancelado=1`,
    notificationUrl: `${env.apiPublicUrl}/api/v1/webhooks/${providerName}`,
  };
  const r = await p.createPayment(order, urls);
  const payment = await Payment.create({
    order_id: order._id,
    proveedor: providerName,
    referencia_externa: r.referencia_externa || undefined,
    estado: 'pendiente',
    monto: order.total,
    respuesta: r.raw || {},
  });
  return { payment_id: String(payment._id), approve_url: r.approve_url, referencia_externa: r.referencia_externa || null };
}

/**
 * Aplica un resultado de proveedor.
 * @param {string} providerName
 * @param {{status:string, referencia_externa:string, order_id:string, monto_cents:number, moneda?:string, raw?:object}} r
 * @returns {Promise<{resultado:string, order_id:string, estado_pedido?:string}>}
 */
async function confirm(providerName, r) {
  if (!r.referencia_externa || !r.order_id) throw badRequest('Respuesta del proveedor incompleta');
  try {
    return await withTransaction(async (session) => {
      const existing = await Payment.findOne({ proveedor: providerName, referencia_externa: r.referencia_externa }).session(session);
      if (existing && existing.estado === 'aprobado') {
        return { resultado: 'duplicado', order_id: String(existing.order_id) };
      }
      // El pago se liga al intento pendiente del pedido si existe (Mercado Pago
      // conoce el id del pago hasta que el cliente paga).
      const payment = existing
        || await Payment.findOne({ order_id: r.order_id, proveedor: providerName, estado: 'pendiente', referencia_externa: { $exists: false } }).session(session)
        || new Payment({ order_id: r.order_id, proveedor: providerName, monto: toDecimal(r.monto_cents || 0) });
      payment.referencia_externa = r.referencia_externa;
      payment.respuesta = { ...(payment.respuesta || {}), ultimo: r.raw || {} };

      if (r.status !== 'aprobado') {
        payment.estado = r.status === 'rechazado' ? 'rechazado' : 'pendiente';
        await payment.save({ session });
        return { resultado: payment.estado, order_id: String(r.order_id) };
      }

      const Order = require('../orders/order.model');
      const pedido = await Order.findById(r.order_id).session(session).lean();
      if (!pedido) throw notFound('Pedido');
      const totalPedido = toCents(pedido.total.toString());
      payment.monto = toDecimal(r.monto_cents ?? totalPedido);
      if (r.monto_cents !== totalPedido) {
        // No debería pasar (el monto lo fija el backend): no se marca pagado y se devuelve.
        payment.estado = 'requiere_reembolso';
        await payment.save({ session });
        await logAccion(null, 'pago.monto_no_coincide', { pagado: r.monto_cents, total: totalPedido, referencia: r.referencia_externa },
          { entidad: 'order', entidadId: String(r.order_id), session });
        return { resultado: 'requiere_reembolso', order_id: String(r.order_id), estado_pedido: pedido.estado };
      }

      const { status, order } = await orders.markPaid(r.order_id, session);
      // Pago de un pedido cancelado o ya pagado por otro medio: hay que devolverlo.
      payment.estado = status === 'pagado' ? 'aprobado' : 'requiere_reembolso';
      await payment.save({ session });
      if (status !== 'pagado') {
        await logAccion(null, 'pago.requiere_reembolso', { proveedor: providerName, referencia: r.referencia_externa, estado_pedido: order.estado },
          { entidad: 'order', entidadId: order.id, session });
      }
      return { resultado: payment.estado, order_id: String(order._id), estado_pedido: order.estado, nuevo: status === 'pagado' };
    });
  } catch (err) {
    if (err.code === 11000) return { resultado: 'duplicado', order_id: String(r.order_id) }; // carrera entre webhooks
    throw err;
  }
}

async function afterConfirm(result) {
  if (result.nuevo) await enqueue('emails', 'order-confirmed', { orderId: result.order_id });
  const { nuevo, ...rest } = result; // eslint-disable-line no-unused-vars
  return rest;
}

/** POST /payments/:provider/capture: el frontend avisa al volver del proveedor. */
async function capture(user, providerName, { order_id, referencia }) {
  const p = provider(providerName);
  const Order = require('../orders/order.model');
  const order = await Order.findById(order_id).lean();
  if (!order || String(order.user_id) !== String(user.id)) throw notFound('Pedido');
  const r = await p.capturePayment({ referencia });
  if (String(r.order_id) !== String(order_id)) throw conflict('PAGO_DE_OTRO_PEDIDO', 'El pago no corresponde a este pedido');
  return afterConfirm(await confirm(providerName, r));
}

/** POST /webhooks/:provider: firma verificada, evento deduplicado. */
async function webhook(providerName, req) {
  const p = provider(providerName);
  if (!(await p.verifyWebhook(req))) throw unauthorized('Firma de webhook inválida');
  const { event_id, fetch } = p.parseWebhook(req);
  try {
    await WebhookEvent.create({ proveedor: providerName, event_id, payload: req.body });
  } catch (err) {
    if (err.code === 11000) return { resultado: 'duplicado' };
    throw err;
  }
  if (!fetch) return { resultado: 'ignorado' };
  const r = await fetch();
  const result = await afterConfirm(await confirm(providerName, r));
  await WebhookEvent.updateOne({ proveedor: providerName, event_id }, { procesado_en: new Date() });
  logger.info({ proveedor: providerName, ...result }, 'webhook de pago procesado');
  return result;
}

/** Al cancelar un pedido pagado, sus pagos aprobados quedan por reembolsar. */
const flagRefund = (orderId, session) => Payment.updateMany(
  { order_id: orderId, estado: 'aprobado' }, { estado: 'requiere_reembolso' }, { session },
);

const listByOrder = (orderId) => Payment.find({ order_id: orderId }).sort({ created_at: 1 }).lean();

module.exports = { create, confirm, capture, webhook, flagRefund, listByOrder, setProvider, providers };
