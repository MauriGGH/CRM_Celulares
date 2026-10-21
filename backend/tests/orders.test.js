const { app, request, models, createUser, createCatalog, imei, stock, checkout } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');
const payments = require('../src/modules/payments/payment.service');
const { toCents } = require('../src/utils/money');

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

/** Pedido pagado de una pieza con IMEI asignado. */
async function pedidoPagado() {
  await createCatalog({ variants: [{ sku: 'S25-256-NEGRO', color: 'Negro', gb: 256, precio: '18999.00', costo: '15000.00', stock: 2, imeis: [imei(10), imei(11)] }] });
  const cliente = await createUser('cliente');
  const almacen = await createUser('almacen');
  const { body: order } = await checkout(cliente, [['S25-256-NEGRO', 1]]);
  await payments.confirm('mercadopago', { status: 'aprobado', referencia_externa: `mp-${order.id}`, order_id: order.id, monto_cents: toCents(order.total) });
  return { cliente, almacen, order };
}

const status = (u, id, estado) => request(app).patch(`/api/v1/admin/orders/${id}/status`).set(u.auth).send({ estado });

describe('pedidos (admin)', () => {
  test('el cliente no entra al panel de pedidos', async () => {
    const cliente = await createUser('cliente');
    const res = await request(app).get('/api/v1/admin/orders').set(cliente.auth);
    expect(res.status).toBe(403);
  });

  test('flujo pagado → preparando → enviado (guía) → entregado', async () => {
    const { almacen, order, cliente } = await pedidoPagado();
    expect((await status(almacen, order.id, 'preparando')).status).toBe(200);

    const sinGuia = await status(almacen, order.id, 'enviado');
    expect(sinGuia.status).toBe(409);
    expect(sinGuia.body.error.code).toBe('ENVIO_REQUERIDO');

    const env = await request(app).post(`/api/v1/admin/orders/${order.id}/shipment`).set(almacen.auth).send({ paqueteria: 'Estafeta', guia: 'EST123456' });
    expect(env.status).toBe(201);
    expect(env.body.estado).toBe('enviado');
    expect(env.body.shipment.guia).toBe('EST123456');

    expect((await status(almacen, order.id, 'entregado')).status).toBe(200);
    const mine = await request(app).get(`/api/v1/orders/${order.id}`).set(cliente.auth);
    expect(mine.body.estado).toBe('entregado');
    expect(mine.body.status_history.map((h) => h.estado)).toEqual(['pendiente_pago', 'pagado', 'preparando', 'enviado', 'entregado']);
  });

  test('transición inválida entregado → pagado responde 409', async () => {
    const { almacen, order } = await pedidoPagado();
    await request(app).post(`/api/v1/admin/orders/${order.id}/shipment`).set(almacen.auth).send({ paqueteria: 'DHL', guia: 'DHL0001' });
    await status(almacen, order.id, 'entregado');
    const res = await status(almacen, order.id, 'pagado');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRANSICION_INVALIDA');
  });

  test('cancelar un pedido pagado regresa el stock y marca el pago por reembolsar', async () => {
    const { almacen, order } = await pedidoPagado();
    expect(await stock('S25-256-NEGRO')).toEqual({ disponible: 1, reservado: 0 });
    const res = await status(almacen, order.id, 'cancelado');
    expect(res.status).toBe(200);
    expect(await stock('S25-256-NEGRO')).toEqual({ disponible: 2, reservado: 0 });
    const pago = await models.Payment.findOne({ order_id: order.id }).lean();
    expect(pago.estado).toBe('requiere_reembolso');
  });

  test('devolución: solicitud, aprobación, recepción con reintegro y reembolso total', async () => {
    const { almacen, order, cliente } = await pedidoPagado();
    await request(app).post(`/api/v1/admin/orders/${order.id}/shipment`).set(almacen.auth).send({ paqueteria: 'DHL', guia: 'DHL0002' });
    await status(almacen, order.id, 'entregado');
    const full = await models.Order.findById(order.id).lean();
    const item = full.items[0];

    const ret = await request(app).post(`/api/v1/orders/${order.id}/returns`).set(cliente.auth)
      .send({ order_item_id: String(item._id), motivo: 'No me gustó', tipo: 'devolucion' });
    expect(ret.status).toBe(201);
    expect(ret.body.imei).toBe(item.imeis[0]);

    const dup = await request(app).post(`/api/v1/orders/${order.id}/returns`).set(cliente.auth)
      .send({ order_item_id: String(item._id), motivo: 'Otra vez', tipo: 'devolucion' });
    expect(dup.status).toBe(409);

    const patch = (estado, extra = {}) => request(app).patch(`/api/v1/admin/returns/${ret.body.id}`).set(almacen.auth).send({ estado, ...extra });
    expect((await patch('aprobada')).status).toBe(200);
    expect((await patch('recibida', { reintegrar_stock: true })).status).toBe(200);
    expect(await stock('S25-256-NEGRO')).toEqual({ disponible: 2, reservado: 0 });
    expect((await models.SerialUnit.findOne({ imei: item.imeis[0] }).lean()).estado).toBe('disponible');
    expect((await patch('reembolsada')).status).toBe(200);
    expect((await models.Order.findById(order.id).lean()).estado).toBe('reembolsado');
  });

  test('no se acepta devolución de un pedido no entregado', async () => {
    const { order, cliente } = await pedidoPagado();
    const full = await models.Order.findById(order.id).lean();
    const res = await request(app).post(`/api/v1/orders/${order.id}/returns`).set(cliente.auth)
      .send({ order_item_id: String(full.items[0]._id), motivo: 'Prueba', tipo: 'devolucion' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PEDIDO_NO_ENTREGADO');
  });

  test('un cliente no ve pedidos de otro', async () => {
    const { order } = await pedidoPagado();
    const otro = await createUser('cliente');
    const res = await request(app).get(`/api/v1/orders/${order.id}`).set(otro.auth);
    expect(res.status).toBe(404);
  });
});
