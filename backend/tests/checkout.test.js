const { app, request, models, createUser, createCatalog, stock, checkout } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');
const orders = require('../src/modules/orders/order.service');

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

describe('checkout', () => {
  test('crea el pedido pendiente_pago con folio y reserva el stock', async () => {
    await createCatalog();
    const cliente = await createUser('cliente');
    const res = await checkout(cliente, [['S25-256-NEGRO', 2]]);
    expect(res.status).toBe(201);
    expect(res.body.folio).toMatch(/^CEL-\d{4}-\d{6}$/);
    expect(res.body.estado).toBe('pendiente_pago');
    expect(res.body.total).toBe('37998.00');
    expect(await stock('S25-256-NEGRO')).toEqual({ disponible: 1, reservado: 2 });

    const cart = await request(app).get('/api/v1/cart').set(cliente.auth);
    expect(cart.body.items).toHaveLength(0);
  });

  test('dos clientes por la última pieza: uno gana y el otro recibe 409', async () => {
    await createCatalog({ variants: [{ sku: 'S25-256-NEGRO', color: 'Negro', gb: 256, precio: '18999.00', stock: 1 }] });
    const a = await createUser('cliente');
    const b = await createUser('cliente');
    for (const c of [a, b]) {
      await request(app).post('/api/v1/cart/items').set(c.auth).send({ sku: 'S25-256-NEGRO', cantidad: 1 });
    }
    const send = (c) => request(app).post('/api/v1/checkout').set(c.auth).send({ address_id: String(c.user.addresses[0]._id) });
    const results = await Promise.all([send(a), send(b)]);
    const codes = results.map((r) => r.status).sort();
    expect(codes).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('STOCK_INSUFICIENTE');
    expect(await stock('S25-256-NEGRO')).toEqual({ disponible: 0, reservado: 1 });
  });

  test('Idempotency-Key repetida devuelve el mismo pedido sin reservar dos veces', async () => {
    await createCatalog();
    const cliente = await createUser('cliente');
    const first = await checkout(cliente, [['S25-256-NEGRO', 1]], { 'Idempotency-Key': 'chk-1' });
    const again = await request(app).post('/api/v1/checkout').set(cliente.auth).set('Idempotency-Key', 'chk-1')
      .send({ address_id: String(cliente.user.addresses[0]._id) });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await models.Order.countDocuments()).toBe(1);
    expect(await stock('S25-256-NEGRO')).toEqual({ disponible: 2, reservado: 1 });
  });

  test('carrito vacío responde 409 CARRITO_VACIO', async () => {
    const cliente = await createUser('cliente');
    const res = await request(app).post('/api/v1/checkout').set(cliente.auth).send({ address_id: String(cliente.user.addresses[0]._id) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CARRITO_VACIO');
  });

  test('la reserva vencida cancela el pedido y libera el stock', async () => {
    await createCatalog();
    const cliente = await createUser('cliente');
    const res = await checkout(cliente, [['S25-256-NEGRO', 1]]);
    await models.Order.updateOne({ _id: res.body.id }, { reservado_hasta: new Date(Date.now() - 1000) });
    expect(await orders.sweepExpired()).toBe(1);
    const order = await models.Order.findById(res.body.id).lean();
    expect(order.estado).toBe('cancelado');
    expect(order.motivo_cancelacion).toBe('reserva_expirada');
    expect(await stock('S25-256-NEGRO')).toEqual({ disponible: 3, reservado: 0 });
    expect(await orders.sweepExpired()).toBe(0);
  });

  test('el cupón descuenta y queda en el pedido', async () => {
    await createCatalog();
    await models.Promotion.create({
      nombre: 'Bienvenida', codigo: 'BIENVENIDA10', tipo_descuento: 'Porcentaje', valor_descuento: 10, aplicacion: 'total',
      fecha_inicio: new Date(Date.now() - 86_400_000), fecha_fin: new Date(Date.now() + 86_400_000),
    });
    const cliente = await createUser('cliente');
    await request(app).post('/api/v1/cart/items').set(cliente.auth).send({ sku: 'S25-256-NEGRO', cantidad: 1 });
    const cup = await request(app).post('/api/v1/cart/coupon').set(cliente.auth).send({ codigo: 'bienvenida10' });
    expect(cup.status).toBe(200);
    const res = await request(app).post('/api/v1/checkout').set(cliente.auth).send({ address_id: String(cliente.user.addresses[0]._id) });
    expect(res.status).toBe(201);
    expect(res.body.descuento).toBe('1899.90');
    expect(res.body.promotion_id).toBeTruthy();
  });

  test('cupón inexistente responde 422 CUPON_INVALIDO', async () => {
    await createCatalog();
    const cliente = await createUser('cliente');
    await request(app).post('/api/v1/cart/items').set(cliente.auth).send({ sku: 'S25-256-NEGRO', cantidad: 1 });
    const cup = await request(app).post('/api/v1/cart/coupon').set(cliente.auth).send({ codigo: 'NOEXISTE' });
    expect(cup.status).toBe(422);
    expect(cup.body.error.code).toBe('CUPON_INVALIDO');
  });
});
