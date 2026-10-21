/**
 * PayPal (portado de mochi-matcha `paypal.controller.js`).
 * - create: orden CAPTURE con custom_id = id del pedido.
 * - capture: captura la orden aprobada por el cliente.
 * - webhook: verificación con /v1/notifications/verify-webhook-signature.
 */
const paypal = require('@paypal/checkout-server-sdk');
const config = require('../../../config/env');
const { AppError } = require('../../../utils/errors');
const { toCents, fromCents } = require('../../../utils/money');

function client() {
  const { clientId, secret, mode } = config.paypal;
  if (!clientId || !secret) throw new AppError(503, 'PAGO_NO_DISPONIBLE', 'PayPal no está configurado');
  const env = mode === 'live'
    ? new paypal.core.LiveEnvironment(clientId, secret)
    : new paypal.core.SandboxEnvironment(clientId, secret);
  return new paypal.core.PayPalHttpClient(env);
}

const baseUrl = () => (config.paypal.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');

async function accessToken() {
  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.paypal.clientId}:${config.paypal.secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new AppError(502, 'PROVEEDOR_ERROR', 'No se pudo autenticar con PayPal');
  return (await res.json()).access_token;
}

function captureToResult(order) {
  const unit = order.purchase_units?.[0] || {};
  const cap = unit.payments?.captures?.[0];
  const ok = order.status === 'COMPLETED' && cap?.status === 'COMPLETED';
  return {
    status: ok ? 'aprobado' : (cap?.status === 'DECLINED' ? 'rechazado' : 'pendiente'),
    referencia_externa: order.id,
    order_id: unit.custom_id || unit.reference_id,
    monto_cents: cap ? toCents(cap.amount.value) : null,
    moneda: cap?.amount?.currency_code,
    raw: { id: order.id, status: order.status, capture_id: cap?.id },
  };
}

module.exports = {
  name: 'paypal',

  async createPayment(order, { returnUrl, cancelUrl }) {
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: String(order._id),
        custom_id: String(order._id),
        description: `Pedido ${order.folio}`,
        amount: { currency_code: 'MXN', value: fromCents(toCents(order.total.toString())) },
      }],
      application_context: {
        brand_name: 'CRM Celulares',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    });
    const res = await client().execute(request);
    const approve = (res.result.links || []).find((l) => l.rel === 'approve' || l.rel === 'payer-action');
    if (!approve) throw new AppError(502, 'PROVEEDOR_ERROR', 'PayPal no devolvió URL de aprobación');
    return { referencia_externa: res.result.id, approve_url: approve.href, raw: { id: res.result.id, status: res.result.status } };
  },

  async capturePayment({ referencia }) {
    const request = new paypal.orders.OrdersCaptureRequest(referencia);
    request.requestBody({});
    try {
      const res = await client().execute(request);
      return captureToResult(res.result);
    } catch (err) {
      // Orden ya capturada: se consulta para responder de forma idempotente.
      if (String(err.message || '').includes('ORDER_ALREADY_CAPTURED')) {
        const get = await client().execute(new paypal.orders.OrdersGetRequest(referencia));
        return captureToResult(get.result);
      }
      throw new AppError(502, 'PROVEEDOR_ERROR', 'PayPal no pudo capturar el pago');
    }
  },

  async verifyWebhook(req) {
    if (!config.paypal.webhookId) return false;
    const h = (n) => req.get(n);
    const res = await fetch(`${baseUrl()}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: config.paypal.webhookId,
        webhook_event: req.body,
      }),
    });
    return res.ok && (await res.json()).verification_status === 'SUCCESS';
  },

  parseWebhook(req) {
    const ev = req.body || {};
    if (ev.event_type !== 'PAYMENT.CAPTURE.COMPLETED') return { event_id: ev.id, fetch: null };
    const r = ev.resource || {};
    return {
      event_id: ev.id,
      fetch: async () => ({
        status: 'aprobado',
        referencia_externa: r.supplementary_data?.related_ids?.order_id,
        order_id: r.custom_id,
        monto_cents: toCents(r.amount?.value),
        moneda: r.amount?.currency_code,
        raw: { capture_id: r.id, status: r.status },
      }),
    };
  },
};
