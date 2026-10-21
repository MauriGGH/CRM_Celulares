const { app, request, models, createUser, createCatalog } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

async function sampleCatalog() {
  await createCatalog({ modelo: 'Galaxy S25', variants: [
    { sku: 'S25-128-NEGRO', color: 'Negro', gb: 128, precio: '16999.00', stock: 2 },
    { sku: 'S25-256-AZUL', color: 'Azul', gb: 256, precio: '18999.00', stock: 0 },
  ] });
  await createCatalog({ modelo: 'Galaxy A16', variants: [{ sku: 'A16-128-NEGRO', color: 'Negro', gb: 128, precio: '3999.00', stock: 5 }] });
  await createCatalog({ marca: 'Apple', modelo: 'iPhone 16', variants: [{ sku: 'IP16-128-AZUL', color: 'Azul', gb: 128, precio: '17499.00', stock: 1 }] });
  await createCatalog({ marca: 'Apple', modelo: 'iPhone 13', condicion: 'reacondicionado', variants: [{ sku: 'IP13-128-NEGRO', color: 'Negro', gb: 128, precio: '8999.00', stock: 1 }] });
  await createCatalog({ modelo: 'Galaxy Borrador', estado: 'borrador', variants: [{ sku: 'BORR-1', color: 'Negro', gb: 128, precio: '100.00', stock: 1 }] });
}

describe('catálogo público', () => {
  test('solo muestra publicados, con paginación estándar', async () => {
    await sampleCatalog();
    const res = await request(app).get('/api/v1/products?limit=2&page=1&sort=nombre');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 2, total: 4 });
    expect(res.body.data).toHaveLength(2);
    const p2 = await request(app).get('/api/v1/products?limit=2&page=2&sort=nombre');
    const todos = [...res.body.data, ...p2.body.data].map((p) => p.modelo);
    expect(todos).toEqual(['Galaxy A16', 'Galaxy S25', 'iPhone 13', 'iPhone 16']);
  });

  test('búsqueda por texto con filtros combinados', async () => {
    await sampleCatalog();
    const res = await request(app).get('/api/v1/products?q=galaxy&brand=samsung&min_price=10000&storage_gb=256');
    expect(res.body.data.map((p) => p.modelo)).toEqual(['Galaxy S25']);
    // El precio desde se calcula solo con las variantes que cumplen el filtro.
    expect(res.body.data[0].precio_desde).toBe('18999.00');

    const usados = await request(app).get('/api/v1/products?condition=reacondicionado');
    expect(usados.body.data.map((p) => p.modelo)).toEqual(['iPhone 13']);

    const barato = await request(app).get('/api/v1/products?max_price=5000');
    expect(barato.body.data.map((p) => p.modelo)).toEqual(['Galaxy A16']);

    const orden = await request(app).get('/api/v1/products?sort=precio_desc&brand=apple');
    expect(orden.body.data.map((p) => p.precio_desde)).toEqual(['17499.00', '8999.00']);

    const multi = await request(app).get('/api/v1/products?q=samsung s25');
    expect(multi.body.data.map((p) => p.modelo)).toEqual(['Galaxy S25']);
  });

  test('filtro inválido responde 422', async () => {
    const res = await request(app).get('/api/v1/products?sort=raro&limit=500');
    expect(res.status).toBe(422);
    expect(res.body.error.details).toHaveProperty('sort');
    expect(res.body.error.details).toHaveProperty('limit');
  });

  test('ficha por slug con disponibilidad por variante; borrador da 404', async () => {
    await sampleCatalog();
    const res = await request(app).get('/api/v1/products/samsung-galaxy-s25');
    expect(res.status).toBe(200);
    const bySku = Object.fromEntries(res.body.variants.map((v) => [v.sku, v]));
    expect(bySku['S25-128-NEGRO']).toMatchObject({ disponible: true, precio: '16999.00' });
    expect(bySku['S25-256-AZUL'].disponible).toBe(false);
    expect(res.body.variants[0].costo).toBeUndefined(); // el costo no es público
    expect((await request(app).get('/api/v1/products/samsung-galaxy-borrador')).status).toBe(404);
  });

  test('marcas y árbol de categorías', async () => {
    await sampleCatalog();
    const cel = await models.Category.findOne({ slug: 'celulares' });
    await models.Category.create({ nombre: 'Gama alta', slug: 'gama-alta', parent_id: cel._id });
    const cats = await request(app).get('/api/v1/categories');
    expect(cats.body.data[0].children[0].slug).toBe('gama-alta');
    const brands = await request(app).get('/api/v1/brands');
    expect(brands.body.data.map((b) => b.nombre)).toEqual(['Apple', 'Samsung']);
  });
});

describe('admin de catálogo', () => {
  test('crear producto con variantes, publicar, y registrar cambio de precio en auditoría', async () => {
    const g = await createUser('gerente');
    const { brand, category } = await createCatalog();
    const res = await request(app).post('/api/v1/admin/products').set(g.auth).send({
      brand_id: brand.id, category_id: category.id, modelo: 'Galaxy Z Flip7', specs: { pantalla_pulgadas: 6.9 },
      variants: [{ sku: 'FLIP7-256-NEGRO', color: 'Negro', almacenamiento_gb: 256, precio: '24999.00', costo: '20000.00' }],
    });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('borrador');
    expect(res.body.variants[0].match_key).toBe('samsung|galaxy z flip7|256|negro');

    const pub = await request(app).patch(`/api/v1/admin/products/${res.body.id}`).set(g.auth).send({ estado: 'publicado' });
    expect(pub.status).toBe(200);

    const vid = res.body.variants[0].id;
    const precio = await request(app).patch(`/api/v1/admin/products/${res.body.id}/variants/${vid}`).set(g.auth).send({ precio: '23999.00' });
    expect(precio.body.precio).toBe('23999.00');
    const audit = await request(app).get('/api/v1/admin/audit?accion=precio.cambio').set(g.auth);
    expect(audit.body.data[0].detalle).toMatchObject({ sku: 'FLIP7-256-NEGRO', precio: { antes: '24999.00', despues: '23999.00' } });
  });

  test('SKU duplicado responde 409 y monto inválido 422', async () => {
    const g = await createUser('gerente');
    const { brand, category } = await createCatalog();
    const dup = await request(app).post('/api/v1/admin/products').set(g.auth).send({
      brand_id: brand.id, category_id: category.id, modelo: 'Otro',
      variants: [{ sku: 'S25-256-NEGRO', color: 'Negro', almacenamiento_gb: 256, precio: '1.00' }],
    });
    expect(dup.status).toBe(409);
    const malo = await request(app).post('/api/v1/admin/products').set(g.auth).send({
      brand_id: brand.id, category_id: category.id, modelo: 'Otro',
      variants: [{ sku: 'X-1', color: 'Negro', almacenamiento_gb: 256, precio: '12,50' }],
    });
    expect(malo.status).toBe(422);
  });

  test('subida de imagen: acepta png y rechaza otros tipos', async () => {
    const g = await createUser('gerente');
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const ok = await request(app).post('/api/v1/admin/uploads').set(g.auth).attach('file', png, { filename: 'a.png', contentType: 'image/png' });
    expect(ok.status).toBe(201);
    expect(ok.body.url).toMatch(/^\/media\/products\/.+\.png$/);
    const txt = await request(app).post('/api/v1/admin/uploads').set(g.auth).attach('file', Buffer.from('hola'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(txt.status).toBe(400);
    require('fs').rmSync(require('path').join(__dirname, '../public/products'), { recursive: true, force: true });
  });
});
