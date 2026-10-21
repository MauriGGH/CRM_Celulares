/**
 * Datos semilla para desarrollo (B3): 6 marcas, 3 categorías, 2 almacenes,
 * 20 teléfonos con variantes, stock con IMEI, un usuario por rol y un cupón.
 *
 *   npm run seed            borra las colecciones del backend y vuelve a sembrar
 *
 * Se niega a correr con NODE_ENV=production.
 */
const env = require('./config/env');
const logger = require('./utils/logger');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const models = require('./utils/models');
const { hashPassword } = require('./utils/password');
const { toDecimal, toCents } = require('./utils/money');
const slugify = require('./utils/slug');
const { matchKey } = require('./modules/catalog/catalog.service');

const { User, Brand, Category, Product, Warehouse, StockLevel, SerialUnit, StockMovement, Promotion, Setting } = models;

const BRANDS = ['Samsung', 'Apple', 'Xiaomi', 'Motorola', 'Google', 'OPPO'];

// [marca, modelo, condición, specs, variantes: [almacenamiento, ram, color, precio, costo]]
const PHONES = [
  ['Samsung', 'Galaxy S25', 'nuevo', { pantalla_pulgadas: 6.2, bateria_mah: 4000, camara_mp: 50, red: '5G' }, [[256, 12, 'Negro', '18999.00', '14800.00'], [256, 12, 'Azul', '18999.00', '14800.00'], [512, 12, 'Negro', '21999.00', '17100.00']]],
  ['Samsung', 'Galaxy S25 Ultra', 'nuevo', { pantalla_pulgadas: 6.9, bateria_mah: 5000, camara_mp: 200, red: '5G' }, [[256, 12, 'Titanio', '27999.00', '22300.00'], [512, 12, 'Titanio', '31499.00', '25100.00']]],
  ['Samsung', 'Galaxy A56', 'nuevo', { pantalla_pulgadas: 6.7, bateria_mah: 5000, camara_mp: 50, red: '5G' }, [[128, 8, 'Gris', '8499.00', '6400.00'], [256, 8, 'Gris', '9499.00', '7200.00']]],
  ['Samsung', 'Galaxy A16', 'nuevo', { pantalla_pulgadas: 6.7, bateria_mah: 5000, camara_mp: 50, red: '4G' }, [[128, 4, 'Negro', '3999.00', '2900.00']]],
  ['Apple', 'iPhone 16', 'nuevo', { pantalla_pulgadas: 6.1, camara_mp: 48, red: '5G' }, [[128, null, 'Azul', '17499.00', '14200.00'], [256, null, 'Negro', '19999.00', '16300.00']]],
  ['Apple', 'iPhone 16 Pro', 'nuevo', { pantalla_pulgadas: 6.3, camara_mp: 48, red: '5G' }, [[256, null, 'Titanio natural', '25999.00', '21400.00'], [512, null, 'Titanio negro', '30999.00', '25600.00']]],
  ['Apple', 'iPhone 15', 'nuevo', { pantalla_pulgadas: 6.1, camara_mp: 48, red: '5G' }, [[128, null, 'Rosa', '14499.00', '11800.00']]],
  ['Apple', 'iPhone 13', 'reacondicionado', { pantalla_pulgadas: 6.1, camara_mp: 12, red: '5G' }, [[128, null, 'Medianoche', '8999.00', '6900.00']]],
  ['Xiaomi', 'Redmi Note 14 Pro', 'nuevo', { pantalla_pulgadas: 6.67, bateria_mah: 5500, camara_mp: 200, red: '4G' }, [[256, 8, 'Negro', '6499.00', '4800.00'], [256, 8, 'Morado', '6499.00', '4800.00']]],
  ['Xiaomi', 'Redmi 14C', 'nuevo', { pantalla_pulgadas: 6.88, bateria_mah: 5160, camara_mp: 50, red: '4G' }, [[128, 4, 'Azul', '2799.00', '2050.00']]],
  ['Xiaomi', 'Xiaomi 15', 'nuevo', { pantalla_pulgadas: 6.36, bateria_mah: 5240, camara_mp: 50, red: '5G' }, [[512, 12, 'Blanco', '19999.00', '15900.00']]],
  ['Xiaomi', 'POCO X7 Pro', 'nuevo', { pantalla_pulgadas: 6.67, bateria_mah: 6000, camara_mp: 50, red: '5G' }, [[256, 12, 'Amarillo', '7999.00', '6100.00']]],
  ['Motorola', 'Moto G85', 'nuevo', { pantalla_pulgadas: 6.67, bateria_mah: 5000, camara_mp: 50, red: '5G' }, [[256, 8, 'Azul', '5499.00', '4000.00'], [256, 8, 'Gris', '5499.00', '4000.00']]],
  ['Motorola', 'Edge 50 Fusion', 'nuevo', { pantalla_pulgadas: 6.7, bateria_mah: 5000, camara_mp: 50, red: '5G' }, [[256, 8, 'Rosa', '7499.00', '5600.00']]],
  ['Motorola', 'Moto E15', 'nuevo', { pantalla_pulgadas: 6.67, bateria_mah: 5200, camara_mp: 32, red: '4G' }, [[64, 2, 'Verde', '1999.00', '1450.00']]],
  ['Google', 'Pixel 9', 'nuevo', { pantalla_pulgadas: 6.3, bateria_mah: 4700, camara_mp: 50, red: '5G' }, [[128, 12, 'Obsidiana', '16999.00', '13500.00'], [256, 12, 'Porcelana', '18999.00', '15100.00']]],
  ['Google', 'Pixel 9a', 'nuevo', { pantalla_pulgadas: 6.3, bateria_mah: 5100, camara_mp: 48, red: '5G' }, [[128, 8, 'Lila', '10999.00', '8600.00']]],
  ['Google', 'Pixel 8', 'usado', { pantalla_pulgadas: 6.2, bateria_mah: 4575, camara_mp: 50, red: '5G' }, [[128, 8, 'Menta', '7499.00', '5400.00']]],
  ['OPPO', 'Reno 13', 'nuevo', { pantalla_pulgadas: 6.59, bateria_mah: 5600, camara_mp: 50, red: '5G' }, [[256, 12, 'Azul', '9999.00', '7600.00']]],
  ['OPPO', 'A80', 'nuevo', { pantalla_pulgadas: 6.67, bateria_mah: 5100, camara_mp: 50, red: '5G' }, [[256, 8, 'Negro', '5299.00', '3900.00']]],
];

/** IMEI de prueba con dígito verificador Luhn válido (prefijo TAC ficticio 35). */
function fakeImei(n) {
  const body = `35${String(n).padStart(12, '0')}`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(body[13 - i]);
    if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return body + ((10 - (sum % 10)) % 10);
}

async function main() {
  if (env.isProd) throw new Error('El seed no corre en producción');
  await connectDatabase(env.mongoUri);
  for (const Model of Object.values(models)) {
    await Model.deleteMany({});
    await Model.syncIndexes();
  }

  const brands = new Map();
  for (const nombre of BRANDS) brands.set(nombre, await Brand.create({ nombre, slug: slugify(nombre) }));
  const celulares = await Category.create({ nombre: 'Celulares', slug: 'celulares' });
  await Category.create({ nombre: 'Tablets', slug: 'tablets' });
  await Category.create({ nombre: 'Accesorios', slug: 'accesorios' });

  const principal = await Warehouse.create({ nombre: 'Almacén principal', tipo: 'almacen', direccion: 'CDMX' });
  const secundario = await Warehouse.create({ nombre: 'Almacén secundario', tipo: 'almacen', direccion: 'Guadalajara' });

  const password = await hashPassword('Cambiar123!');
  const users = [
    ['admin@crm-celulares.local', 'Admin', 'admin'],
    ['gerente@crm-celulares.local', 'Gerente', 'gerente'],
    ['almacen@crm-celulares.local', 'Almacén', 'almacen'],
    ['cliente@crm-celulares.local', 'Cliente de prueba', 'cliente'],
  ];
  for (const [email, nombre, rol] of users) {
    await User.create({
      email, nombre, rol, password_hash: password,
      addresses: rol === 'cliente'
        ? [{ nombre_destinatario: nombre, calle: 'Av. Reforma', numero: '100', colonia: 'Juárez', ciudad: 'Ciudad de México', estado: 'CDMX', cp: '06600', es_principal: true }]
        : [],
    });
  }

  let imeiSeq = 1;
  for (const [marca, modelo, condicion, specs, variantes] of PHONES) {
    const brand = brands.get(marca);
    const variants = variantes.map(([gb, ram, color, precio, costo]) => ({
      sku: slugify(`${marca}-${modelo}-${gb}-${color}`).toUpperCase(),
      color, almacenamiento_gb: gb, ram_gb: ram || undefined,
      precio: toDecimal(toCents(precio)), costo: toDecimal(toCents(costo)),
      precio_antes: condicion === 'nuevo' && gb >= 256 ? toDecimal(toCents(precio) + 150000) : undefined,
      match_key: matchKey(marca, modelo, gb, color),
    }));
    const product = await Product.create({
      brand_id: brand._id, brand_nombre: marca, category_id: celulares._id, modelo,
      slug: slugify(`${marca} ${modelo}`),
      descripcion: `${marca} ${modelo} ${condicion === 'nuevo' ? 'nuevo, sellado' : condicion}, con garantía.`,
      specs, condicion, garantia_meses: condicion === 'nuevo' ? 12 : 3, estado: 'publicado',
      images: [`https://placehold.co/600x600?text=${encodeURIComponent(`${marca} ${modelo}`)}`],
      variants,
    });

    for (const v of product.variants) {
      // Principal: 3 a 6 unidades con IMEI. Secundario: 0 a 2 sin IMEI registrado.
      const conImei = 3 + (imeiSeq % 4);
      const sinImei = imeiSeq % 3;
      const serials = Array.from({ length: conImei }, () => ({
        imei: fakeImei(imeiSeq++), sku: v.sku, product_id: product._id, warehouse_id: principal._id,
      }));
      const created = await SerialUnit.insertMany(serials);
      await StockLevel.create({ sku: v.sku, product_id: product._id, warehouse_id: principal._id, disponible: conImei, stock_minimo: 2 });
      await StockMovement.insertMany(created.map((s) => ({
        sku: v.sku, product_id: product._id, warehouse_id: principal._id, tipo: 'entrada', cantidad: 1, referencia: 'seed', serial_unit_id: s._id,
      })));
      if (sinImei) {
        await StockLevel.create({ sku: v.sku, product_id: product._id, warehouse_id: secundario._id, disponible: sinImei });
        await StockMovement.create({ sku: v.sku, product_id: product._id, warehouse_id: secundario._id, tipo: 'entrada', cantidad: sinImei, referencia: 'seed' });
      }
    }
  }

  const ahora = new Date();
  const enUnAnio = new Date(ahora.getTime() + 365 * 86_400_000);
  await Promotion.create({
    nombre: 'Bienvenida 10%', codigo: 'BIENVENIDA10', tipo_descuento: 'Porcentaje', valor_descuento: 10,
    aplicacion: 'total', fecha_inicio: ahora, fecha_fin: enUnAnio, usos_maximos: 1000,
  });
  await Setting.create([
    { clave: 'costo_envio', valor: '199.00' },
    { clave: 'envio_gratis_desde', valor: '5000.00' },
    { clave: 'almacen_online_id', valor: String(principal._id) },
  ]);

  const total = await Product.countDocuments();
  logger.info({ productos: total, imeis: imeiSeq - 1 }, 'seed listo');
   
  console.log(`Seed listo: ${total} teléfonos, ${imeiSeq - 1} IMEI. Usuarios: ${users.map((u) => u[0]).join(', ')} (contraseña Cambiar123!)`);
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.error({ err }, 'seed falló');
   
  console.error(err);
  process.exit(1);
});
