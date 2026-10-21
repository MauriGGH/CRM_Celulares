/**
 * Fábricas para tests: usuarios con token, catálogo mínimo con stock e IMEI.
 */
const request = require('supertest');
const app = require('../src/app');
const models = require('../src/utils/models');
const { hashPassword } = require('../src/utils/password');
const { signAccess } = require('../src/modules/auth/auth.service');
const { toDecimal, toCents } = require('../src/utils/money');
const { matchKey, isValidImei } = {
  ...require('../src/modules/catalog/catalog.service'),
  ...require('../src/modules/inventory/inventory.service'),
};

let seq = 0;

async function createUser(rol = 'cliente', extra = {}) {
  seq++;
  const user = await models.User.create({
    email: `${rol}${seq}@test.mx`,
    nombre: `${rol} ${seq}`,
    rol,
    password_hash: await hashPassword('Secreta123'),
    addresses: rol === 'cliente'
      ? [{ nombre_destinatario: 'Ana', calle: 'Reforma', numero: '1', ciudad: 'CDMX', estado: 'CDMX', cp: '06600', es_principal: true }]
      : [],
    ...extra,
  });
  return { user, token: signAccess(user).access_token, auth: { Authorization: `Bearer ${signAccess(user).access_token}` } };
}

/** IMEI válido (Luhn) a partir de un número. */
function imei(n) {
  const body = `35${String(n).padStart(12, '0')}`;
  for (let d = 0; d <= 9; d++) if (isValidImei(body + d)) return body + d;
  throw new Error('no imei');
}

/**
 * Crea marca, categoría, almacén y un producto publicado.
 * @param {{variants?: Array<{sku, color, gb, precio, costo, stock, imeis?, gtin?}>, estado?, modelo?, marca?}} opts
 */
async function createCatalog(opts = {}) {
  const marca = opts.marca || 'Samsung';
  const brand = await models.Brand.findOneAndUpdate({ nombre: marca }, { nombre: marca, slug: marca.toLowerCase() }, { upsert: true, new: true });
  const category = await models.Category.findOneAndUpdate({ slug: 'celulares' }, { nombre: 'Celulares', slug: 'celulares' }, { upsert: true, new: true });
  const warehouse = opts.warehouse || await models.Warehouse.findOneAndUpdate({ nombre: 'Principal' }, { nombre: 'Principal' }, { upsert: true, new: true });
  const modelo = opts.modelo || 'Galaxy S25';
  const variants = (opts.variants || [{ sku: 'S25-256-NEGRO', color: 'Negro', gb: 256, precio: '18999.00', costo: '15000.00', stock: 3 }]);
  const product = await models.Product.create({
    brand_id: brand._id, brand_nombre: brand.nombre, category_id: category._id, modelo,
    slug: `${marca}-${modelo}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    condicion: opts.condicion || 'nuevo',
    estado: opts.estado || 'publicado',
    variants: variants.map((v) => ({
      sku: v.sku, color: v.color, almacenamiento_gb: v.gb, ram_gb: v.ram,
      precio: toDecimal(toCents(v.precio)), costo: toDecimal(toCents(v.costo || '0')), gtin: v.gtin,
      match_key: matchKey(brand.nombre, modelo, v.gb, v.color),
    })),
  });
  for (const v of variants) {
    if (v.stock == null) continue;
    await models.StockLevel.create({ sku: v.sku, product_id: product._id, warehouse_id: warehouse._id, disponible: v.stock });
    for (const i of v.imeis || []) {
      await models.SerialUnit.create({ imei: i, sku: v.sku, product_id: product._id, warehouse_id: warehouse._id });
    }
  }
  return { brand, category, warehouse, product };
}

const stock = async (sku) => {
  const rows = await models.StockLevel.find({ sku }).lean();
  return rows.reduce((a, r) => ({ disponible: a.disponible + r.disponible, reservado: a.reservado + r.reservado }), { disponible: 0, reservado: 0 });
};

/** Agrega al carrito y hace checkout; devuelve la respuesta del checkout. */
async function checkout(cliente, items, headers = {}) {
  for (const [sku, cantidad] of items) {
    const r = await request(app).post('/api/v1/cart/items').set(cliente.auth).send({ sku, cantidad });
    if (r.status !== 201) throw new Error(`cart ${r.status} ${JSON.stringify(r.body)}`);
  }
  return request(app).post('/api/v1/checkout').set(cliente.auth).set(headers)
    .send({ address_id: String(cliente.user.addresses[0]._id) });
}

module.exports = { app, request, models, createUser, createCatalog, imei, stock, checkout };
