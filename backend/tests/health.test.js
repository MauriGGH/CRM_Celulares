const request = require('supertest');
const app = require('../src/app');
const { startDb, stopDb } = require('./db');

beforeAll(startDb);
afterAll(stopDb);

test('GET /api/v1/health responde ok con Mongo conectado', async () => {
  const res = await request(app).get('/api/v1/health');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: 'ok', mongo: 'conectado' });
});

test('ruta inexistente responde 404 con formato de error estándar', async () => {
  const res = await request(app).get('/api/v1/no-existe');
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('RUTA_NO_ENCONTRADA');
});
