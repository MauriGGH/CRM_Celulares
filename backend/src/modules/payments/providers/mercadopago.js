/**
 * Mercado Pago (Checkout Pro) por su API REST.
 * - create: preferencia con external_reference = id del pedido.
 * - capture: consulta GET /v1/payments/:id (MP cobra al aprobarse; no hay captura aparte).
 * - webhook: firma `x-signature: ts=…,v1=…` = HMAC-SHA256(secret, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;").
 */
const crypto = require('crypto');
const config = require('../../../config/env');
const { AppError } = require('../../../utils/errors');
const { toCents, fromCents } = require('../../../utils/money');

const API = 'https://api.mercadopago.com';

async function mp(path, { method = 'GET', body, idempotencyKey } = {}) {
  if (!config.mercadopago.accessToken) throw new AppError(503, 'PAGO_NO_DISPONIBLE', 'Mercado Pago no está configurado');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.mercadopago.accessToken}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AppError(502, 'PROVEEDOR_ERROR', 'Mercado Pago rechazó la solicitud', { status: res.status, message: data.message });
  return data;
}

const STATUS = { approved: 'aprobado', authorized: 'pendiente', in_process: 'pendiente', pending: 'pendiente', rejected: 'rechazado', cancelled: 'rechazado', refunded: 'reembolsado', charged_back: 'reembolsado' };

function toResult(p) {
  return {
    status: STATUS[p.status] || 'pendiente',
    referencia_externa: String(p.id),
    order_id: p.external_reference,
    monto_cents: toCents(p.transaction_amount),
    moneda: p.currency_id,
    raw: { id: p.id, status: p.status, status_detail: p.status_detail, payment_method_id: p.payment_method_id },
  };
}

module.exports = {
  name: 'mercadopago',

  /** @param {{_id, folio, total, items}} order */
  async createPayment(order, { returnUrl, notificationUrl }) {
    const pref = await mp('/checkout/preferences', {
      method: 'POST',
      idempotencyKey: `pref-${order._id}`,
      body: {
        external_reference: String(order._id),
        statement_descriptor: 'CRM CELULARES',
        items: [{ id: order.folio, title: `Pedido ${order.folio}`, quantity: 1, currency_id: 'MXN', unit_price: Number(fromCents(toCents(order.total.toString()))) }],
        back_urls: { success: returnUrl, pending: returnUrl, failure: returnUrl },
        auto_return: 'approved',
        notification_url: notificationUrl,
        expires: true,
        expiration_date_to: new Date(order.reservado_hasta).toISOString(),
      },
    });
    return { preference_id: pref.id, approve_url: pref.init_point, raw: { preference_id: pref.id } };
  },

  /** @param {{referencia:string}} p id de pago de MP (llega en el redirect como payment_id) */
  async capturePayment({ referencia }) {
    return toResult(await mp(`/v1/payments/${encodeURIComponent(referencia)}`));
  },

  verifyWebhook(req) {
    const secret = config.mercadopago.webhookSecret;
    const sig = req.get('x-signature') || '';
    const parts = Object.fromEntries(sig.split(',').map((kv) => kv.split('=').map((x) => x.trim())));
    if (!secret || !parts.ts || !parts.v1) return false;
    let dataId = String(req.query['data.id'] ?? req.body?.data?.id ?? '');
    if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
    const manifest = `id:${dataId};request-id:${req.get('x-request-id') || ''};ts:${parts.ts};`;
    const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
    return expected.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  },

  /** @returns {{event_id:string, fetch: (() => Promise<object>)|null}} */
  parseWebhook(req) {
    const type = req.body?.type || req.query.type || req.query.topic;
    const id = String(req.query['data.id'] ?? req.body?.data?.id ?? '');
    const eventId = `${type}:${id}:${req.body?.action || ''}`;
    if (type !== 'payment' || !id) return { event_id: eventId, fetch: null };
    return { event_id: eventId, fetch: () => module.exports.capturePayment({ referencia: id }) };
  },
};
