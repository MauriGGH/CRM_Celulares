const { app, request, models, createUser, createCatalog } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');
const { drain } = require('../src/utils/queue');
const sample = require('../../docs/contracts/examples/ingest-batch.example.json');

const AUTH = { Authorization: 'Bearer test-service-token' };
const send = (body, key) => request(app).post('/internal/v1/ingest/batches').set(AUTH).set('Idempotency-Key', key).send(body);

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

describe('POST /internal/v1/ingest/batches', () => {
  test('sin token de servicio responde 401', async () => {
    const res = await request(app).post('/internal/v1/ingest/batches').send(sample);
    expect(res.status).toBe(401);
  });

  test('sin Idempotency-Key responde 400', async () => {
    const res = await request(app).post('/internal/v1/ingest/batches').set(AUTH).send(sample);
    expect(res.status).toBe(400);
  });

  test('lote válido responde 202 y se puede consultar', async () => {
    const res = await request(app)
      .post('/internal/v1/ingest/batches')
      .set(AUTH)
      .set('Idempotency-Key', 'lote-1')
      .send(sample);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('en_cola');

    const get = await request(app).get(`/internal/v1/ingest/batches/${res.body.batch_id}`).set(AUTH);
    expect(get.status).toBe(200);
    expect(get.body.record_count).toBe(sample.records.length);
  });

  test('reenviar con la misma Idempotency-Key no duplica', async () => {
    const send = () => request(app)
      .post('/internal/v1/ingest/batches')
      .set(AUTH)
      .set('Idempotency-Key', 'lote-2')
      .send(sample);
    const first = await send();
    const second = await send();
    expect(second.status).toBe(200);
    expect(second.body.batch_id).toBe(first.body.batch_id);
  });

  test('sobre que no cumple el contrato responde 422', async () => {
    const bad = { ...sample, schema_version: '9.9', records: [] };
    const res = await request(app)
      .post('/internal/v1/ingest/batches')
      .set(AUTH)
      .set('Idempotency-Key', 'lote-3')
      .send(bad);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LOTE_INVALIDO');
  });

  test('un registro inválido no tumba el lote: queda como invalido con su motivo', async () => {
    const lote = { ...sample, records: [...sample.records, { external_id: 'x-1', brand: 'Samsung' }] };
    const res = await send(lote, 'lote-4');
    expect(res.status).toBe(202);
    await drain();
    const get = await request(app).get(`/internal/v1/ingest/batches/${res.body.batch_id}`).set(AUTH);
    expect(get.body.status).toBe('listo');
    expect(get.body.stats.invalido).toBe(1);
    expect(get.body.invalidos).toEqual([expect.objectContaining({ external_id: 'x-1', motivo: expect.any(String) })]);
  });
});

describe('empate de registros y revisión del gerente', () => {
  test('con el lote de ejemplo, un registro coincide y otro queda como nuevo', async () => {
    await createCatalog({ variants: [{ sku: 'S25-256-NEGRO', color: 'Negro', gb: 256, precio: '19499.00', stock: 1 }] });
    const res = await send(sample, 'lote-5');
    await drain();
    const get = await request(app).get(`/internal/v1/ingest/batches/${res.body.batch_id}`).set(AUTH);
    expect(get.body.stats).toEqual({ coincide: 1, nuevo: 1, conflicto: 0, invalido: 0 });

    const precio = await models.CompetitorPrice.findOne({ 'meta.sku': 'S25-256-NEGRO' }).lean();
    expect(precio.precio.toString()).toBe('18999.00');
    expect(precio.meta.source).toBe('tienda_competidor_a');

    // El precio de venta propio no cambia.
    const p = await models.Product.findOne({ 'variants.sku': 'S25-256-NEGRO' }).lean();
    expect(p.variants[0].precio.toString()).toBe('19499.00');
  });

  test('gtin coincide aunque el modelo venga escrito distinto', async () => {
    await createCatalog({ marca: 'Apple', modelo: 'iPhone 16', variants: [{ sku: 'IP16-128-AZUL', color: 'Azul', gb: 128, precio: '17999.00', gtin: '0195949000000', stock: 0 }] });
    const lote = { ...sample, records: [{ ...sample.records[1], model: 'iphone16 (2024)' }] };
    await send(lote, 'lote-6');
    await drain();
    const rec = await models.IngestRecord.findOne({ external_id: 'a-789012' }).lean();
    expect(rec).toMatchObject({ resultado: 'coincide', sku: 'IP16-128-AZUL', motivo: 'gtin' });
  });

  test('el gerente aprueba un nuevo: se crea un borrador y se guarda el precio', async () => {
    await models.Category.create({ nombre: 'Celulares', slug: 'celulares' });
    const res = await send({ ...sample, records: [sample.records[1]] }, 'lote-7');
    await drain();
    const gerente = await createUser('gerente');
    const pend = await request(app).get('/api/v1/admin/ingest/records?decision=pendiente').set(gerente.auth);
    expect(pend.status).toBe(200);
    expect(pend.body.data).toHaveLength(1);
    expect(pend.body.data[0].batch_id).toBe(res.body.batch_id);

    const ok = await request(app).post(`/api/v1/admin/ingest/records/${pend.body.data[0].id}/approve`).set(gerente.auth).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.decision).toBe('aprobado');
    const draft = await models.Product.findById(ok.body.product_creado_id).lean();
    expect(draft.estado).toBe('borrador');
    expect(await models.CompetitorPrice.countDocuments({ 'meta.sku': ok.body.sku })).toBe(1);

    const again = await request(app).post(`/api/v1/admin/ingest/records/${pend.body.data[0].id}/approve`).set(gerente.auth).send({});
    expect(again.status).toBe(409);

    // El siguiente lote del mismo listado ya empata solo.
    await send({ ...sample, records: [sample.records[1]] }, 'lote-8');
    await drain();
    expect(await models.IngestRecord.countDocuments({ resultado: 'coincide', sku: ok.body.sku })).toBe(1);
  });

  test('el almacén no revisa ingesta', async () => {
    const almacen = await createUser('almacen');
    const res = await request(app).get('/api/v1/admin/ingest/records').set(almacen.auth);
    expect(res.status).toBe(403);
  });

  test('la copia del contrato en el backend es idéntica a docs/contracts', () => {
    const fs = require('fs');
    const path = require('path');
    const docs = fs.readFileSync(path.join(__dirname, '../../docs/contracts/ingest-batch.schema.json'), 'utf8');
    const local = fs.readFileSync(path.join(__dirname, '../src/modules/ingest/contracts/ingest-batch.schema.json'), 'utf8');
    expect(JSON.parse(local)).toEqual(JSON.parse(docs));
  });
});
