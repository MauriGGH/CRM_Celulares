const jwt = require('jsonwebtoken');
const { app, request, createUser } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

const refreshCookie = (res) => (res.headers['set-cookie'] || []).find((c) => c.startsWith('refresh_token='));

describe('auth', () => {
  test('registro de cliente: 201, token de 15 min y cookie httpOnly sameSite=strict', async () => {
    const res = await request(app).post('/api/v1/auth/register')
      .send({ email: 'Nuevo@Test.mx', password: 'Secreta123', nombre: 'Nuevo' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'nuevo@test.mx', rol: 'cliente' });
    expect(res.body.expires_in).toBeLessThanOrEqual(15 * 60);
    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(res.body.user.password_hash).toBeUndefined();
  });

  test('registro con correo repetido responde 409', async () => {
    const { user } = await createUser('cliente');
    const res = await request(app).post('/api/v1/auth/register').send({ email: user.email, password: 'Secreta123', nombre: 'X' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_REGISTRADO');
  });

  test('registro con datos inválidos responde 422 con detalle por campo', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({ email: 'no-es-correo', password: '1' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(['email', 'password', 'nombre']));
  });

  test('login correcto de staff: token de 8 h', async () => {
    const { user } = await createUser('gerente');
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Secreta123' });
    expect(res.status).toBe(200);
    expect(res.body.expires_in).toBeGreaterThan(7 * 3600);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.access_token}`);
    expect(me.body).toMatchObject({ rol: 'gerente', email: user.email });
  });

  test('contraseña errónea y usuario inactivo responden 401 igual', async () => {
    const { user } = await createUser('cliente');
    const bad = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'otra-cosa' });
    expect(bad.status).toBe(401);
    const { user: inactivo } = await createUser('cliente', { is_active: false });
    const res = await request(app).post('/api/v1/auth/login').send({ email: inactivo.email, password: 'Secreta123' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe(bad.body.error.message);
  });

  test('token vencido responde 401', async () => {
    const { user } = await createUser('cliente');
    const vencido = jwt.sign({ sub: String(user._id), rol: 'cliente', typ: 'access', exp: Math.floor(Date.now() / 1000) - 10 }, 'test-secret');
    const res = await request(app).get('/api/v1/cart').set('Authorization', `Bearer ${vencido}`);
    expect(res.status).toBe(401);
  });

  test('rol sin permiso responde 403', async () => {
    const cliente = await createUser('cliente');
    const res = await request(app).get('/api/v1/admin/products').set(cliente.auth);
    expect(res.status).toBe(403);
    const almacen = await createUser('almacen');
    expect((await request(app).get('/api/v1/admin/reports/sales').set(almacen.auth)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/stock').set(almacen.auth)).status).toBe(200);
  });

  test('refresh rota el token; reutilizar el anterior revoca todas las sesiones', async () => {
    const { user } = await createUser('cliente');
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Secreta123' });
    const c1 = refreshCookie(login).split(';')[0];
    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', c1);
    expect(r1.status).toBe(200);
    const c2 = refreshCookie(r1).split(';')[0];
    expect(c2).not.toBe(c1);

    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', c1);
    expect(reuse.status).toBe(401);
    // El token nuevo también quedó revocado por la reutilización.
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', c2)).status).toBe(401);
  });

  test('logout revoca el refresh token', async () => {
    const { user } = await createUser('cliente');
    const login = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Secreta123' });
    const c = refreshCookie(login).split(';')[0];
    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', c)).status).toBe(204);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', c)).status).toBe(401);
  });

  test('login: 5 intentos por minuto por IP, el sexto responde 429', async () => {
    const { user } = await createUser('cliente');
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/v1/auth/login').set('CF-Connecting-IP', '203.0.113.9').send({ email: user.email, password: 'mal' });
      expect(r.status).toBe(401);
    }
    const sexto = await request(app).post('/api/v1/auth/login').set('CF-Connecting-IP', '203.0.113.9').send({ email: user.email, password: 'Secreta123' });
    expect(sexto.status).toBe(429);
    expect(sexto.headers['retry-after']).toBeDefined();
    // Otra IP no está bloqueada.
    const otra = await request(app).post('/api/v1/auth/login').set('CF-Connecting-IP', '203.0.113.10').send({ email: user.email, password: 'Secreta123' });
    expect(otra.status).toBe(200);
  });

  test('direcciones del cliente: alta, principal única y borrado', async () => {
    const c = await createUser('cliente');
    const nueva = await request(app).post('/api/v1/me/addresses').set(c.auth)
      .send({ nombre_destinatario: 'Luis', calle: 'Juárez', ciudad: 'Puebla', estado: 'Puebla', cp: '72000', es_principal: true });
    expect(nueva.status).toBe(201);
    const list = await request(app).get('/api/v1/me/addresses').set(c.auth);
    expect(list.body.data.filter((a) => a.es_principal)).toHaveLength(1);
    expect(list.body.data.find((a) => a.es_principal).cp).toBe('72000');
    expect((await request(app).delete(`/api/v1/me/addresses/${nueva.body.id}`).set(c.auth)).status).toBe(204);
    const cpMalo = await request(app).post('/api/v1/me/addresses').set(c.auth).send({ nombre_destinatario: 'x', calle: 'x', ciudad: 'x', estado: 'x', cp: '123' });
    expect(cpMalo.status).toBe(422);
  });

  test('gerente no puede crear administradores; admin sí', async () => {
    const gerente = await createUser('gerente');
    const body = { email: 'nuevo-admin@test.mx', password: 'Secreta123', nombre: 'X', rol: 'admin' };
    expect((await request(app).post('/api/v1/admin/users').set(gerente.auth).send(body)).status).toBe(403);
    const admin = await createUser('admin');
    expect((await request(app).post('/api/v1/admin/users').set(admin.auth).send(body)).status).toBe(201);
    const cliente = { ...body, email: 'c@test.mx', rol: 'cliente' };
    expect((await request(app).post('/api/v1/admin/users').set(admin.auth).send(cliente)).status).toBe(422);
  });
});
