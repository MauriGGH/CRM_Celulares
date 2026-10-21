/**
 * Lecturas de la API externa (B15). Filas planas y estables; nunca datos
 * personales de clientes, costos ni IMEI. Paginación por cursor: `cursor` es
 * el id de la última fila y el orden es por id ascendente, así una
 * sincronización no salta ni repite filas aunque entren datos nuevos.
 */
const { Types } = require('mongoose');
const Product = require('../catalog/product.model');
const StockLevel = require('../inventory/stock-level.model');
const Warehouse = require('../inventory/warehouse.model');
const Order = require('../orders/order.model');
const CompetitorPrice = require('../ingest/competitor-price.model');
const env = require('../../config/env');
const { escapeRegex } = require('../users/user.service');
const { toCents, fromCents } = require('../../utils/money');
const { notFound } = require('../../utils/errors');

const money = (d) => (d == null ? null : fromCents(toCents(d.toString())));
const oid = (s) => new Types.ObjectId(String(s));
const TZ = 'America/Mexico_City';
const PAGADOS = ['pagado', 'preparando', 'enviado', 'entregado'];

function page(rows, limit) {
  const more = rows.length > limit;
  const data = more ? rows.slice(0, limit) : rows;
  return { data, next_cursor: more ? data[data.length - 1].id : null };
}

function range(field, from, to) {
  if (!from && !to) return {};
  const r = {};
  if (from) r.$gte = new Date(from);
  if (to) r.$lte = new Date(to);
  return { [field]: r };
}

// ─── Productos (una fila por variante publicada) ──────────────────────────

const PRODUCT_COLUMNS = ['id', 'sku', 'product_id', 'marca', 'modelo', 'color', 'almacenamiento_gb', 'ram_gb', 'condicion', 'precio', 'precio_antes',
  'moneda', 'disponible', 'gtin', 'url', 'imagen', 'updated_at'];

function variantRow(p, v, unidades) {
  return {
    id: String(v._id),
    sku: v.sku,
    product_id: String(p._id),
    marca: p.brand_nombre,
    modelo: p.modelo,
    color: v.color,
    almacenamiento_gb: v.almacenamiento_gb,
    ram_gb: v.ram_gb ?? null,
    condicion: p.condicion,
    precio: money(v.precio),
    precio_antes: money(v.precio_antes),
    moneda: 'MXN',
    disponible: unidades > 0,
    gtin: v.gtin || null,
    url: `${env.publicUrl}/producto/${p.slug}`,
    imagen: v.images?.[0] || p.images?.[0] || null,
    specs: p.specs || {},
    updated_at: p.updated_at,
  };
}

const sumDisponible = (niveles) => niveles.reduce((s, n) => s + n.disponible, 0);

/** @param {{updated_since?, marca?, cursor?, limit:number}} q */
async function products(q) {
  const match = { estado: 'publicado', ...range('updated_at', q.updated_since) };
  if (q.marca) match.brand_nombre = new RegExp(`^${escapeRegex(q.marca)}$`, 'i');
  const rows = await Product.aggregate([
    { $match: match },
    { $unwind: '$variants' },
    { $match: { 'variants.is_active': { $ne: false }, ...(q.cursor ? { 'variants._id': { $gt: oid(q.cursor) } } : {}) } },
    { $sort: { 'variants._id': 1 } },
    { $limit: q.limit + 1 },
    { $lookup: { from: 'stock_levels', localField: 'variants.sku', foreignField: 'sku', as: 'niveles' } },
  ]);
  return page(rows.map((p) => variantRow(p, p.variants, sumDisponible(p.niveles))), q.limit);
}

async function productBySku(sku) {
  const p = await Product.findOne({ estado: 'publicado', 'variants.sku': String(sku).toUpperCase() }).lean();
  const v = p?.variants.find((x) => x.sku === String(sku).toUpperCase() && x.is_active !== false);
  if (!v) throw notFound('Producto');
  const niveles = await StockLevel.find({ sku: v.sku }).lean();
  return variantRow(p, v, sumDisponible(niveles));
}

// ─── Stock (una fila por SKU y almacén) ───────────────────────────────────

const STOCK_COLUMNS = ['id', 'sku', 'warehouse_id', 'almacen', 'disponible', 'reservado', 'updated_at'];

async function stock(q) {
  const filter = { ...range('updated_at', q.updated_since), ...(q.cursor ? { _id: { $gt: oid(q.cursor) } } : {}) };
  if (q.sku) filter.sku = String(q.sku).toUpperCase();
  const [rows, almacenes] = await Promise.all([
    StockLevel.find(filter).sort({ _id: 1 }).limit(q.limit + 1).lean(),
    Warehouse.find().select('nombre').lean(),
  ]);
  const nombre = new Map(almacenes.map((w) => [String(w._id), w.nombre]));
  return page(rows.map((r) => ({
    id: String(r._id), sku: r.sku, warehouse_id: String(r.warehouse_id), almacen: nombre.get(String(r.warehouse_id)) || null,
    disponible: r.disponible, reservado: r.reservado, updated_at: r.updated_at,
  })), q.limit);
}

// ─── Histórico de precios de la competencia ──────────────────────────────

const PRICE_COLUMNS = ['id', 'sku', 'source', 'precio', 'moneda', 'en_stock', 'url', 'captured_at'];

async function priceHistory(q) {
  const filter = { ...range('captured_at', q.from, q.to), ...(q.cursor ? { _id: { $gt: oid(q.cursor) } } : {}) };
  if (q.sku) filter['meta.sku'] = String(q.sku).toUpperCase();
  if (q.source) filter['meta.source'] = q.source;
  const rows = await CompetitorPrice.find(filter).sort({ _id: 1 }).limit(q.limit + 1).lean();
  return page(rows.map((r) => ({
    id: String(r._id), sku: r.meta.sku, source: r.meta.source, precio: money(r.precio), moneda: 'MXN',
    en_stock: r.en_stock, url: r.url || null, captured_at: r.captured_at,
  })), q.limit);
}

// ─── Ventas agregadas ─────────────────────────────────────────────────────

const SALES_COLUMNS = { day: ['dia', 'pedidos', 'unidades', 'ventas', 'moneda'], brand: ['marca', 'pedidos', 'unidades', 'ventas', 'moneda'], sku: ['sku', 'nombre', 'pedidos', 'unidades', 'ventas', 'moneda'] };

/**
 * Ventas pagadas agregadas por día (hora de CDMX), marca o SKU. Solo
 * totales: ningún pedido individual ni dato de cliente.
 * @param {{group_by:'day'|'brand'|'sku', from?, to?}} q
 */
async function sales(q) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
  const key = {
    day: { $dateToString: { date: '$pagado_en', format: '%Y-%m-%d', timezone: TZ } },
    brand: { $ifNull: [{ $arrayElemAt: ['$p.brand_nombre', 0] }, 'Sin marca'] },
    sku: '$items.sku',
  }[q.group_by];
  const pipeline = [
    { $match: { estado: { $in: PAGADOS }, pagado_en: { $gte: from, $lte: to } } },
    { $unwind: '$items' },
  ];
  if (q.group_by === 'brand') pipeline.push({ $lookup: { from: 'products', localField: 'items.product_id', foreignField: '_id', as: 'p' } }); // sin pipeline: MongoDB 4.4
  pipeline.push(
    { $group: { _id: key, nombre: { $first: '$items.nombre' }, pedidos: { $addToSet: '$_id' }, unidades: { $sum: '$items.cantidad' }, ventas: { $sum: '$items.subtotal' } } },
    { $sort: { _id: 1 } },
  );
  const rows = await Order.aggregate(pipeline);
  const campo = { day: 'dia', brand: 'marca', sku: 'sku' }[q.group_by];
  return {
    from, to, group_by: q.group_by, moneda: 'MXN',
    data: rows.map((r) => ({
      [campo]: r._id, ...(q.group_by === 'sku' ? { nombre: r.nombre } : {}),
      pedidos: r.pedidos.length, unidades: r.unidades, ventas: fromCents(toCents(r.ventas.toString())), moneda: 'MXN',
    })),
  };
}

module.exports = { products, productBySku, stock, priceHistory, sales, PRODUCT_COLUMNS, STOCK_COLUMNS, PRICE_COLUMNS, SALES_COLUMNS };
