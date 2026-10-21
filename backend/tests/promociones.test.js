const { models } = require('./helpers');
const { startDb, stopDb, clearDb } = require('./db');
const { aplicarPromociones, aplicaHoy } = require('../src/utils/promociones');

beforeAll(startDb);
afterEach(clearDb);
afterAll(stopDb);

const A = '64b000000000000000000001';
const B = '64b000000000000000000002';
const vigencia = () => ({ fecha_inicio: new Date(Date.now() - 86_400_000), fecha_fin: new Date(Date.now() + 86_400_000) });
const item = (product_id, cantidad, precio) => ({ product_id, sku: `SKU-${product_id.slice(-1)}`, cantidad, precio_unitario: precio, subtotal: precio * cantidad });
const total = (carrito) => Math.round(carrito.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;

describe('motor de promociones', () => {
  test('Porcentaje sobre un producto', async () => {
    await models.Promotion.create({ nombre: '10%', tipo_descuento: 'Porcentaje', valor_descuento: 10, productos_aplicables: [A], ...vigencia() });
    const { carrito, aplicadas } = await aplicarPromociones([item(A, 1, 1000), item(B, 1, 500)]);
    expect(aplicadas).toHaveLength(1);
    expect(total(carrito)).toBe(1400);
  });

  test('2x1 cobra la mitad de los pares', async () => {
    await models.Promotion.create({ nombre: '2x1', tipo_descuento: '2x1', productos_aplicables: [A], ...vigencia() });
    const { carrito } = await aplicarPromociones([item(A, 3, 100)]);
    expect(total(carrito)).toBe(200);
  });

  test('Monto fijo al total', async () => {
    await models.Promotion.create({ nombre: '-300', tipo_descuento: 'Monto fijo', valor_descuento: 300, aplicacion: 'total', ...vigencia() });
    const { carrito } = await aplicarPromociones([item(A, 1, 1000), item(B, 1, 500)]);
    expect(total(carrito)).toBe(1200);
  });

  test('con dos automáticas elegibles no aplica ninguna y devuelve las opciones', async () => {
    await models.Promotion.create([
      { nombre: 'x', tipo_descuento: 'Porcentaje', valor_descuento: 5, productos_aplicables: [A], ...vigencia() },
      { nombre: 'y', tipo_descuento: 'Porcentaje', valor_descuento: 8, productos_aplicables: [A], ...vigencia() },
    ]);
    const { aplicadas, elegibles } = await aplicarPromociones([item(A, 1, 1000)]);
    expect(aplicadas).toHaveLength(0);
    expect(elegibles).toHaveLength(2);
  });

  test('el cupón gana sobre las automáticas', async () => {
    await models.Promotion.create([
      { nombre: 'auto', tipo_descuento: 'Porcentaje', valor_descuento: 5, productos_aplicables: [A], ...vigencia() },
      { nombre: 'cupón', codigo: 'VIP20', tipo_descuento: 'Porcentaje', valor_descuento: 20, aplicacion: 'total', ...vigencia() },
    ]);
    const { carrito, aplicadas } = await aplicarPromociones([item(A, 1, 1000)], { codigo: 'vip20' });
    expect(aplicadas[0].codigo).toBe('VIP20');
    expect(total(carrito)).toBe(800);
  });

  test('promo vencida no aplica', async () => {
    await models.Promotion.create({ nombre: 'vieja', tipo_descuento: 'Porcentaje', valor_descuento: 50, aplicacion: 'total', fecha_inicio: new Date('2020-01-01'), fecha_fin: new Date('2020-02-01') });
    const { aplicadas } = await aplicarPromociones([item(A, 1, 1000)]);
    expect(aplicadas).toHaveLength(0);
  });

  test('días de la semana: 0 = lunes', () => {
    const lunes = new Date('2026-10-19T12:00:00');
    expect(aplicaHoy({ dias_semana: '0' }, lunes)).toBe(true);
    expect(aplicaHoy({ dias_semana: '1,2' }, lunes)).toBe(false);
    expect(aplicaHoy({ dias_semana: '' }, lunes)).toBe(true);
  });
});
