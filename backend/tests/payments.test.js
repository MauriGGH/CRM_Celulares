const crypto = require('crypto');
const { app, request, models, createUser, createCatalog, imei, stock, checkout } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');
const payments = require('../src/modules/payments/payment.service');
const mercadopago = require('../src/modules/payments/providers/mercadopago');
const { toCents } = require('../src/utils/money');

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

/** Proveedor simulado: `pagos` simula la API de Mercado Pago por id de pago. */
const pagos = new Map();
const fake = {
  name: 'mercadopago',
  async createPayment(order) { return { approve_url: `https://pago.test/${order._id}`, raw: {} }; },
  async capturePayment({ referencia }) { return pagos.get(referencia); },
  verifyWebhook: (req) => mercadopago.verifyWebhook(req),
  parseWebhook(req) {
    const id = String(req.body?.data?.id);
    return { event_id: `payment:${id}:${req.body.action}`, fetch: async () => pagos.get(id) };
  },
};

beforeAll(() => payments.setProvider('mercadopago', fake));
afterAll(() => payments.setProvider('mercadopago', mercadopago));

async function pedido(variant = {}) {
  const imeis = [imei(1), imei(2)];
  await createCatalog({ variants: [{ sku: 'S25-256-NEGRO', color: 'Negro', gb: 256, precio: '18999.00', costo: '15000.00', stock: 2, imeis, ...variant }] });
  const cliente = await createUser('cliente');
  const res = await checkout(cliente, [['S25-256-NEGRO', 1]]);
  expect(res.status).toBe(201);
  return { cliente, order: res.body, imeis };
}

function aprobar(id, order, extra = {}) {
  pagos.set(id, {
    status: 'aprobado', referencia_externa: id, order_id: order.id, monto_cents: toCents(order.total), moneda: 'MXN', raw: {}, ...extra,
  });
}

function firma(dataId, requestId = 'req-1', ts = String(Date.now())) {
  const v1 = crypto.createHmac('sha256', 'test-mp-secret').update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
  return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
}

describe('pagos', () => {
  test('create devuelve la URL del proveedor', async () => {
    const { cliente, order } = await pedido();
    const res = await request(app).post('/api/v1/payments/mercadopago/create').set(cliente.auth).send({ order_id: order.id });
    expect(res.status).toBe(201);
    expect(res.body.approve_url).toContain(order.id);
  });

  test('capture aprobado marca pagado, descuenta stock y asigna IMEI', async () => {
    const { cliente, order, imeis } = await pedido();
    aprobar('mp-1', order);
    const res = await request(app).post('/api/v1/payments/mercadopago/capture').set(cliente.auth)
      .send({ order_id: order.id, referencia: 'mp-1' });
    expect(res.status).toBe(200);
    expect(res.body.resultado).toBe('aprobado');

    const o = await models.Order.findById(order.id).lean();
    expect(o.estado).toBe('pagado');
    expect(o.items[0].imeis).toHaveLength(1);
    expect(imeis).toContain(o.items[0].imeis[0]);
    expect(await stock('S25-256-NEGRO')).toEqual({ disponible: 1, reservado: 0 });
    const serial = await models.SerialUnit.findOne({ imei: o.items[0].imeis[0] }).lean();
    expect(serial.estado).toBe('vendido');
  });

  test('webhook firmado y repetido no descuenta dos veces', async () => {
    const { order } = await pedido();
    aprobar('777', order);
    const send = () => request(app).post('/api/v1/webhooks/mercadopago?data.id=777&type=payment')
      .set(firma('777')).send({ action: 'payment.updated', type: 'payment', data: { id: '777' } });
    const first = await send();
    expect(first.status).toBe(200);
    expect(first.body.resultado).toBe('aprobado');
    const second = await send();
    expect(second.status).toBe(200);
    expect(second.body.resultado).toBe('duplicado');

    // Otro evento distinto del mismo pago tampoco vuelve a cobrar.
    const third = await request(app).post('/api/v1/webhooks/mercadopago?data.id=777&type=payment')
      .set(firma('777', 'req-2')).send({ action: 'payment.created', type: 'payment', data: { id: '777' } });
    expect(third.body.resultado).toBe('duplicado');
    expect(await stock('S25-256-NEGRO')).toEqual({ disponible: 1, reservado: 0 });
    expect(await models.StockMovement.countDocuments({ tipo: 'venta' })).toBe(1);
  });

  test('webhook con firma inválida responde 401', async () => {
    const res = await request(app).post('/api/v1/webhooks/mercadopago?data.id=1')
      .set({ 'x-signature': 'ts=1,v1=deadbeef', 'x-request-id': 'r' }).send({ data: { id: '1' } });
    expect(res.status).toBe(401);
  });

  test('monto distinto al total no marca pagado: requiere_reembolso', async () => {
    const { cliente, order } = await pedido();
    aprobar('mp-2', order, { monto_cents: 100 });
    const res = await request(app).post('/api/v1/payments/mercadopago/capture').set(cliente.auth)
      .send({ order_id: order.id, referencia: 'mp-2' });
    expect(res.body.resultado).toBe('requiere_reembolso');
    expect((await models.Order.findById(order.id).lean()).estado).toBe('pendiente_pago');
  });

  test('pago tardío de un pedido cancelado queda requiere_reembolso', async () => {
    const { cliente, order } = await pedido();
    await request(app).post(`/api/v1/orders/${order.id}/cancel`).set(cliente.auth).send({});
    aprobar('mp-3', order);
    const r = await payments.confirm('mercadopago', pagos.get('mp-3'));
    expect(r.resultado).toBe('requiere_reembolso');
    expect(await stock('S25-256-NEGRO')).toEqual({ disponible: 2, reservado: 0 });
  });

  test('pago de otro pedido responde 409', async () => {
    const { cliente, order } = await pedido();
    aprobar('mp-4', { ...order, id: '507f1f77bcf86cd799439011' });
    const res = await request(app).post('/api/v1/payments/mercadopago/capture').set(cliente.auth)
      .send({ order_id: order.id, referencia: 'mp-4' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAGO_DE_OTRO_PEDIDO');
  });
});
