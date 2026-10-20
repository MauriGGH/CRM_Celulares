const request = require('supertest');
const app = require('../src/app');
const { startDb, stopDb, clearDb } = require('./db');
const sample = require('../../docs/contracts/examples/ingest-batch.example.json');

const AUTH = { Authorization: 'Bearer test-service-token' };

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

  test('lote que no cumple el contrato responde 422', async () => {
    const bad = { ...sample, records: [{ brand: 'Samsung' }] };
    const res = await request(app)
      .post('/internal/v1/ingest/batches')
      .set(AUTH)
      .set('Idempotency-Key', 'lote-3')
      .send(bad);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LOTE_INVALIDO');
  });
});
