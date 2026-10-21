const { app, request, models, createUser, createCatalog, imei, stock } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

describe('inventario', () => {
  test('entrada y ajuste registran movimientos; un ajuste no deja stock negativo', async () => {
    const a = await createUser('almacen');
    const { warehouse } = await createCatalog();
    const base = { sku: 'S25-256-NEGRO', warehouse_id: warehouse.id };
    expect((await request(app).post('/api/v1/admin/stock/movements').set(a.auth).send({ ...base, tipo: 'entrada', cantidad: 5 })).status).toBe(201);
    expect((await stock('S25-256-NEGRO')).disponible).toBe(8);
    const neg = await request(app).post('/api/v1/admin/stock/movements').set(a.auth).send({ ...base, tipo: 'ajuste', cantidad: -9 });
    expect(neg.status).toBe(409);
    expect(neg.body.error.code).toBe('STOCK_INSUFICIENTE');
    expect((await request(app).post('/api/v1/admin/stock/movements').set(a.auth).send({ ...base, tipo: 'ajuste', cantidad: -2 })).status).toBe(201);
    expect((await stock('S25-256-NEGRO')).disponible).toBe(6);
    expect(await models.StockMovement.countDocuments({ sku: 'S25-256-NEGRO' })).toBe(2);
  });

  test('traspaso mueve stock e IMEI y nunca deja stock negativo', async () => {
    const a = await createUser('almacen');
    const { warehouse } = await createCatalog({ variants: [{ sku: 'S25-256-NEGRO', color: 'Negro', gb: 256, precio: '18999.00', stock: 2, imeis: [imei(1), imei(2)] }] });
    const destino = await models.Warehouse.create({ nombre: 'Secundario' });
    const body = { tipo: 'traspaso', sku: 'S25-256-NEGRO', warehouse_id: warehouse.id, warehouse_destino_id: destino.id };
    const demasiado = await request(app).post('/api/v1/admin/stock/movements').set(a.auth).send({ ...body, cantidad: 3 });
    expect(demasiado.status).toBe(409);
    expect((await stock('S25-256-NEGRO')).disponible).toBe(2);

    const ok = await request(app).post('/api/v1/admin/stock/movements').set(a.auth).send({ ...body, cantidad: 1 });
    expect(ok.status).toBe(201);
    const levels = await models.StockLevel.find({ sku: 'S25-256-NEGRO' }).lean();
    expect(Object.fromEntries(levels.map((l) => [String(l.warehouse_id), l.disponible]))).toEqual({ [warehouse.id]: 1, [destino.id]: 1 });
    expect(await models.SerialUnit.countDocuments({ warehouse_id: destino._id })).toBe(1);
  });

  test('alta de IMEI en lote: suma stock; duplicado 409; Luhn inválido 422', async () => {
    const a = await createUser('almacen');
    const { warehouse } = await createCatalog({ variants: [{ sku: 'S25-256-NEGRO', color: 'Negro', gb: 256, precio: '18999.00', stock: 0 }] });
    const body = { sku: 's25-256-negro', warehouse_id: warehouse.id, imeis: [imei(10), imei(11), imei(12)] };
    const res = await request(app).post('/api/v1/admin/serials').set(a.auth).send(body);
    expect(res.status).toBe(201);
    expect(res.body.creados).toBe(3);
    expect((await stock('S25-256-NEGRO')).disponible).toBe(3);

    const dup = await request(app).post('/api/v1/admin/serials').set(a.auth).send({ ...body, imeis: [imei(13), imei(10)] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.imeis).toEqual([imei(10)]);
    expect(await models.SerialUnit.countDocuments()).toBe(3); // todo o nada

    const malo = imei(14).slice(0, 14) + ((Number(imei(14)[14]) + 1) % 10);
    const luhn = await request(app).post('/api/v1/admin/serials').set(a.auth).send({ ...body, imeis: [malo] });
    expect(luhn.status).toBe(422);
    expect(luhn.body.error.code).toBe('IMEI_INVALIDO');

    const hist = await request(app).get(`/api/v1/admin/serials/${imei(10)}`).set(a.auth);
    expect(hist.status).toBe(200);
    expect(hist.body).toMatchObject({ estado: 'disponible', sku: 'S25-256-NEGRO' });
    expect(hist.body.historial[0].tipo).toBe('entrada');
  });

  test('stock bajo según umbral de settings', async () => {
    const g = await createUser('gerente');
    await createCatalog({ variants: [
      { sku: 'S25-128-NEGRO', color: 'Negro', gb: 128, precio: '1.00', stock: 1 },
      { sku: 'S25-256-NEGRO', color: 'Negro', gb: 256, precio: '1.00', stock: 10 },
    ] });
    await request(app).put('/api/v1/admin/settings').set(g.auth).send({ stock_bajo_umbral: 2 });
    const res = await request(app).get('/api/v1/admin/stock?bajo=true').set(g.auth);
    expect(res.body.data.map((r) => r.sku)).toEqual(['S25-128-NEGRO']);
    expect(res.body.umbral_stock_bajo).toBe(2);
  });
});
