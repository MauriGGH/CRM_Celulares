const { app, request, models, createUser } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');
const { parseCapacidades, parsePrecio } = require('../src/modules/modelos/modelo.service');

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

// Mismo formato que crm_celulares.modelos (equipo de datos).
const FICHA = {
  id: 1,
  marca: 'Apple',
  modelo: 'iPhone 16 Plus',
  almacenamiento: '128GB / 256GB / 512GB',
  memoria_ram: '8GB',
  procesador: 'Apple A18 (3 nm)',
  pantalla: '6.7 inches, 1290 x 2796 pixels',
  medidas: '160.9 x 77.8 x 7.8 mm (6.33 x 3.06 x 0.31 in) (199 g (7.02 oz))',
  bateria: 'Li-Ion 4674 mAh, Wired, PD2.0',
  camara_principal: '48 MP, f/1.6, 26mm (wide)',
  sistema_operativo: 'iOS 18, up to iOS 27',
  precio: '$899 USD',
  imagen: 'https://fdn2.gsmarena.com/vv/bigpic/apple-iphone-16-plus.jpg',
  url_gsmarena: 'https://www.gsmarena.com/apple_iphone_16_plus-13316.php',
};

describe('fichas de modelos', () => {
  test('normaliza capacidades y precio de referencia', () => {
    expect(parseCapacidades('128GB / 256GB / 512GB / 1TB')).toEqual([128, 256, 512, 1024]);
    expect(parseCapacidades('8GB / 12GB')).toEqual([8, 12]);
    expect(parsePrecio('$899 USD')).toEqual({ monto: '899.00', moneda: 'USD' });
    expect(parsePrecio('')).toBeNull();
  });

  test('el gerente busca y ve la ficha normalizada', async () => {
    await models.Modelo.collection.insertMany([FICHA, { ...FICHA, id: 2, marca: 'Samsung', modelo: 'Galaxy S25' }]);
    const g = await createUser('gerente');
    const list = await request(app).get('/api/v1/admin/modelos?q=iphone').set(g.auth);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ ref: 1, almacenamiento_gb: [128, 256, 512], ram_gb: [8] });
    expect(list.body.data[0].specs).toMatchObject({ pantalla_pulgadas: 6.7, bateria_mah: 4674, peso_g: 199 });

    const one = await request(app).get('/api/v1/admin/modelos/1').set(g.auth);
    expect(one.body.modelo).toBe('iPhone 16 Plus');
  });

  test('importar crea un borrador con variantes en MXN y no duplica al repetir', async () => {
    await models.Modelo.collection.insertOne(FICHA);
    await models.Category.create({ nombre: 'Celulares', slug: 'celulares' });
    const g = await createUser('gerente');
    const body = { variantes: [{ color: 'Negro', almacenamiento_gb: 128, precio: '19999.00' }, { color: 'Negro', almacenamiento_gb: 256, precio: '22999.00' }] };
    const res = await request(app).post('/api/v1/admin/modelos/1/import').set(g.auth).send(body);
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('borrador');
    expect(res.body.origen).toBe('modelos');
    expect(res.body.variants.map((v) => v.precio)).toEqual(['19999.00', '22999.00']);
    expect(res.body.variants[0].ram_gb).toBe(8);
    expect(res.body.images).toEqual([FICHA.imagen]);
    expect(res.body.specs.procesador).toBe('Apple A18 (3 nm)');

    const again = await request(app).post('/api/v1/admin/modelos/1/import').set(g.auth)
      .send({ variantes: [...body.variantes, { color: 'Rosa', almacenamiento_gb: 128, precio: '19999.00' }] });
    expect(again.body.variants).toHaveLength(3);
    expect(await models.Product.countDocuments()).toBe(1);
  });

  test('precio con formato inválido responde 422 y el almacén no entra', async () => {
    await models.Modelo.collection.insertOne(FICHA);
    const g = await createUser('gerente');
    const bad = await request(app).post('/api/v1/admin/modelos/1/import').set(g.auth)
      .send({ variantes: [{ color: 'Negro', almacenamiento_gb: 128, precio: '$899 USD' }] });
    expect(bad.status).toBe(422);
    const a = await createUser('almacen');
    expect((await request(app).get('/api/v1/admin/modelos').set(a.auth)).status).toBe(403);
  });

  test('ficha inexistente responde 404', async () => {
    const g = await createUser('gerente');
    expect((await request(app).get('/api/v1/admin/modelos/999').set(g.auth)).status).toBe(404);
  });
});
