const { app, request, models, createUser, createCatalog, checkout } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');
const { drain } = require('../src/utils/queue');
const payments = require('../src/modules/payments/payment.service');
const { toCents } = require('../src/utils/money');

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

async function newClient(body = {}) {
  const g = await createUser('gerente');
  const res = await request(app).post('/api/v1/admin/api-clients').set(g.auth)
    .send({ nombre: 'BI externo', scopes: ['catalog:read', 'stock:read', 'prices:read', 'sales:read'], ...body });
  expect(res.status).toBe(201);
  return { gerente: g, client: res.body, key: { 'X-API-Key': res.body.api_key } };
}

/** N variantes publicadas en un producto. */
async function catalogo(n) {
  await createCatalog({
    variants: Array.from({ length: n }, (_, i) => ({ sku: `S25-${String(i).padStart(3, '0')}`, color: `Color ${i}`, gb: 128, precio: '10000.00', costo: '8000.00', stock: i % 2 })),
  });
}

describe('API externa: llaves', () => {
  test('sin llave o con llave inválida responde 401', async () => {
    expect((await request(app).get('/external/v1/products')).status).toBe(401);
    const res = await request(app).get('/external/v1/products').set('X-API-Key', 'ck_00000000_nope-nope-nope-nope-nope-nope');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('API_KEY_INVALIDA');
  });

  test('la llave solo se muestra al crearla y no se guarda en claro', async () => {
    const { gerente, client } = await newClient();
    expect(client.api_key).toMatch(/^ck_[0-9a-f]{8}_/);
    const list = await request(app).get('/api/v1/admin/api-clients').set(gerente.auth);
    expect(list.body[0].api_key).toBeUndefined();
    expect(list.body[0].key_hash).toBeUndefined();
    const raw = await models.ApiClient.findById(client.id).select('+key_hash').lean();
    expect(raw.key_hash).not.toContain(client.api_key);
  });

  test('scope faltante responde 403', async () => {
    const { key } = await newClient({ scopes: ['catalog:read'] });
    const res = await request(app).get('/external/v1/stock').set(key);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SCOPE_INSUFICIENTE');
  });

  test('límite excedido responde 429 con RateLimit-*', async () => {
    const { key } = await newClient({ limite_por_minuto: 2 });
    const a = await request(app).get('/external/v1/me').set(key);
    expect(a.headers['ratelimit-limit']).toBe('2');
    expect(a.headers['ratelimit-remaining']).toBe('1');
    await request(app).get('/external/v1/me').set(key);
    const c = await request(app).get('/external/v1/me').set(key);
    expect(c.status).toBe(429);
    expect(c.headers['retry-after']).toBeDefined();
  });

  test('revocar, rotar y vencer invalidan la llave', async () => {
    const { gerente, client, key } = await newClient();
    const rot = await request(app).post(`/api/v1/admin/api-clients/${client.id}/rotate`).set(gerente.auth);
    expect((await request(app).get('/external/v1/me').set(key)).status).toBe(401);
    const nueva = { 'X-API-Key': rot.body.api_key };
    expect((await request(app).get('/external/v1/me').set(nueva)).status).toBe(200);

    await request(app).delete(`/api/v1/admin/api-clients/${client.id}`).set(gerente.auth);
    expect((await request(app).get('/external/v1/me').set(nueva)).status).toBe(401);

    const otro = await newClient({ vence_en: new Date(Date.now() - 1000).toISOString() });
    expect((await request(app).get('/external/v1/me').set(otro.key)).status).toBe(401);
  });

  test('cada llamada queda en api_access_logs', async () => {
    const { key, client } = await newClient();
    await request(app).get('/external/v1/me').set(key);
    await new Promise((r) => setTimeout(r, 50));
    const log = await models.ApiAccessLog.findOne({ client_id: client.id }).lean();
    expect(log).toMatchObject({ method: 'GET', path: '/external/v1/me', status: 200 });
  });

  test('el almacén no administra llaves', async () => {
    const a = await createUser('almacen');
    expect((await request(app).get('/api/v1/admin/api-clients').set(a.auth)).status).toBe(403);
  });
});

describe('API externa: datos', () => {
  test('paginación por cursor sin huecos ni repetidos', async () => {
    await catalogo(25);
    const { key } = await newClient();
    const vistos = [];
    let cursor = null;
    let paginas = 0;
    do {
      const res = await request(app).get('/external/v1/products').query({ limit: 7, ...(cursor ? { cursor } : {}) }).set(key);
      expect(res.status).toBe(200);
      vistos.push(...res.body.data.map((r) => r.sku));
      cursor = res.body.meta.next_cursor;
      paginas++;
    } while (cursor);
    expect(paginas).toBe(4);
    expect(vistos).toHaveLength(25);
    expect(new Set(vistos).size).toBe(25);
  });

  test('producto sin costos ni datos internos; updated_since filtra', async () => {
    await catalogo(2);
    const { key } = await newClient();
    const one = await request(app).get('/external/v1/products/S25-001').set(key);
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ sku: 'S25-001', precio: '10000.00', moneda: 'MXN', disponible: true });
    expect(one.body.costo).toBeUndefined();
    const futuro = await request(app).get('/external/v1/products').query({ updated_since: new Date(Date.now() + 60_000).toISOString() }).set(key);
    expect(futuro.body.data).toHaveLength(0);
  });

  test('CSV con ?format=csv y el cursor en X-Next-Cursor', async () => {
    await catalogo(3);
    const { key } = await newClient();
    const res = await request(app).get('/external/v1/stock?format=csv&limit=2').set(key);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['x-next-cursor']).toBeDefined();
    expect(res.text.split('\r\n')[0]).toBe('id,sku,warehouse_id,almacen,disponible,reservado,updated_at');
  });

  test('ventas solo agregadas', async () => {
    await createCatalog();
    const cliente = await createUser('cliente');
    const { body: order } = await checkout(cliente, [['S25-256-NEGRO', 1]]);
    await payments.confirm('mercadopago', { status: 'aprobado', referencia_externa: 'x-1', order_id: order.id, monto_cents: toCents(order.total) });
    const { key } = await newClient();
    const res = await request(app).get('/external/v1/reports/sales?group_by=sku').set(key);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ sku: 'S25-256-NEGRO', nombre: expect.any(String), pedidos: 1, unidades: 1, ventas: '18999.00', moneda: 'MXN' }]);
    expect(JSON.stringify(res.body)).not.toContain(cliente.user.email);
  });

  test('exportación CSV asíncrona que se descarga con el enlace firmado', async () => {
    await catalogo(5);
    const { key } = await newClient();
    const post = await request(app).post('/external/v1/exports').set(key).send({ resource: 'products', format: 'csv' });
    expect(post.status).toBe(202);
    await drain();
    const st = await request(app).get(`/external/v1/exports/${post.body.export_id}`).set(key);
    expect(st.body).toMatchObject({ status: 'listo', rows: 5 });
    const url = new URL(st.body.download_url);
    const dl = await request(app).get(url.pathname + url.search);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('text/csv');
    expect(dl.text.trim().split('\r\n')).toHaveLength(6);

    // Firma alterada o vencida: 404.
    const bad = await request(app).get(url.pathname + url.search.replace(/sig=[0-9a-f]/, 'sig=0'));
    expect(bad.status).toBe(404);
    const expired = url.search.replace(/expires=\d+/, `expires=${Math.floor(Date.now() / 1000) - 10}`);
    expect((await request(app).get(url.pathname + expired)).status).toBe(404);
  });

  test('exportación xlsx y scope del recurso', async () => {
    await catalogo(2);
    const { key } = await newClient();
    const post = await request(app).post('/external/v1/exports').set(key).send({ resource: 'stock', format: 'xlsx' });
    await drain();
    const st = await request(app).get(`/external/v1/exports/${post.body.export_id}`).set(key);
    expect(st.body.status).toBe('listo');
    const sinPrecios = await newClient({ scopes: ['catalog:read'] });
    const res = await request(app).post('/external/v1/exports').set(sinPrecios.key).send({ resource: 'prices', format: 'csv' });
    expect(res.status).toBe(403);
    // Otro cliente no ve la exportación ajena.
    expect((await request(app).get(`/external/v1/exports/${post.body.export_id}`).set(sinPrecios.key)).status).toBe(404);
  });
});
