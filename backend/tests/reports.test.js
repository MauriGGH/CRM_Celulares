const { app, request, createUser, createCatalog, imei, checkout } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');
const payments = require('../src/modules/payments/payment.service');
const { toCents } = require('../src/utils/money');

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

async function venta() {
  await createCatalog({ variants: [{ sku: 'S25-256-NEGRO', color: 'Negro', gb: 256, precio: '18999.00', costo: '15000.00', stock: 3, imeis: [imei(20)] }] });
  const cliente = await createUser('cliente');
  const { body: order } = await checkout(cliente, [['S25-256-NEGRO', 1]]);
  await payments.confirm('mercadopago', { status: 'aprobado', referencia_externa: 'r-1', order_id: order.id, monto_cents: toCents(order.total) });
  return order;
}

describe('reportes', () => {
  test('solo gerente o admin', async () => {
    const almacen = await createUser('almacen');
    expect((await request(app).get('/api/v1/admin/reports/sales').set(almacen.auth)).status).toBe(403);
  });

  test('ventas, márgenes e inventario reflejan la venta', async () => {
    await venta();
    const g = await createUser('gerente');
    const sales = await request(app).get('/api/v1/admin/reports/sales').set(g.auth);
    expect(sales.status).toBe(200);
    expect(sales.body.resumen.pedidos).toBe(1);

    const margins = await request(app).get('/api/v1/admin/reports/margins').set(g.auth);
    expect(margins.body.filas[0]).toMatchObject({ sku: 'S25-256-NEGRO', unidades: 1, costo: '15000.00' });

    const inv = await request(app).get('/api/v1/admin/reports/inventory').set(g.auth);
    expect(inv.body.filas[0]).toMatchObject({ sku: 'S25-256-NEGRO', disponible: 2 });
  });

  test.each([['xlsx', 'spreadsheetml'], ['pdf', 'pdf']])('exporta %s', async (formato, tipo) => {
    await venta();
    const g = await createUser('gerente');
    const res = await request(app).post('/api/v1/admin/reports/export').set(g.auth).send({ tipo: 'sales', formato })
      .buffer(true).parse((r, cb) => { const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain(tipo);
    expect(res.body.length).toBeGreaterThan(500);
  });
});
