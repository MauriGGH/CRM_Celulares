/**
 * Inventario: niveles de stock por almacén, reservas del checkout,
 * movimientos y unidades con IMEI.
 *
 * Toda escritura de stock usa updates condicionales ($inc con filtro
 * `disponible >= n`), así nunca queda negativo aunque dos peticiones
 * compitan; dentro de una transacción, el perdedor se reintenta y recibe
 * STOCK_INSUFICIENTE.
 */
const Warehouse = require('./warehouse.model');
const StockLevel = require('./stock-level.model');
const SerialUnit = require('./serial-unit.model');
const StockMovement = require('./stock-movement.model');
const { getConfig, getConfigInt } = require('../../utils/configuracion');
const { conflict, notFound, badRequest } = require('../../utils/errors');
const { withTransaction } = require('../../utils/transaction');
const { escapeRegex } = require('../users/user.service');

// Se requiere en tiempo de llamada para evitar el ciclo catalog ↔ inventory.
const catalog = () => require('../catalog/catalog.service');

const stockInsuficiente = (sku, pedido, disponible) => conflict(
  'STOCK_INSUFICIENTE', `No hay suficiente stock de ${sku}`, { sku, solicitado: pedido, disponible },
);

// ─── Disponibilidad ───────────────────────────────────────────────────────

/** @param {string[]} skus @returns {Promise<Map<string, number>>} sku → disponible */
async function availabilityBySku(skus) {
  const rows = await StockLevel.aggregate([
    { $match: { sku: { $in: skus } } },
    { $group: { _id: '$sku', disponible: { $sum: '$disponible' } } },
  ]);
  return new Map(rows.map((r) => [r._id, r.disponible]));
}

/** @param {any[]} productIds @returns {Promise<Map<string, number>>} */
async function availabilityByProduct(productIds) {
  const rows = await StockLevel.aggregate([
    { $match: { product_id: { $in: productIds } } },
    { $group: { _id: '$product_id', disponible: { $sum: '$disponible' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.disponible]));
}

// ─── Reservas (checkout) ──────────────────────────────────────────────────

/**
 * Aparta stock para cada línea. Elige un almacén con existencia suficiente
 * (primero el almacén online configurado, luego el de más stock).
 * @param {{sku:string, cantidad:number}[]} items
 * @param {import('mongoose').ClientSession} session
 * @returns {Promise<{sku:string, cantidad:number, warehouse_id:any}[]>}
 */
async function reserve(items, session) {
  const preferido = await getConfig('almacen_online_id');
  const out = [];
  for (const { sku, cantidad } of items) {
    const levels = await StockLevel.find({ sku }).session(session).lean();
    levels.sort((a, b) => {
      if (preferido && String(a.warehouse_id) === String(preferido)) return -1;
      if (preferido && String(b.warehouse_id) === String(preferido)) return 1;
      return b.disponible - a.disponible;
    });
    let ok = null;
    for (const lvl of levels) {
      if (lvl.disponible < cantidad) continue;
      const r = await StockLevel.updateOne(
        { _id: lvl._id, disponible: { $gte: cantidad } },
        { $inc: { disponible: -cantidad, reservado: cantidad } },
        { session },
      );
      if (r.modifiedCount === 1) { ok = lvl; break; }
    }
    if (!ok) throw stockInsuficiente(sku, cantidad, levels.reduce((s, l) => s + l.disponible, 0));
    out.push({ sku, cantidad, warehouse_id: ok.warehouse_id });
  }
  return out;
}

/** Devuelve lo reservado a disponible (reserva vencida o pedido cancelado antes de pagar). */
async function release(items, session) {
  for (const { sku, cantidad, warehouse_id } of items) {
    await StockLevel.updateOne(
      { sku, warehouse_id, reservado: { $gte: cantidad } },
      { $inc: { disponible: cantidad, reservado: -cantidad } },
      { session },
    );
  }
}

/**
 * Pago confirmado: lo reservado sale del inventario, se registra el
 * movimiento `venta` y se asignan IMEI disponibles del mismo almacén.
 * @param {{_id:any, sku:string, cantidad:number, warehouse_id:any, product_id:any}[]} items líneas del pedido
 * @param {{orderId:any, folio:string, userId?:any}} ref
 * @returns {Promise<Map<string, string[]>>} order_item_id → IMEI asignados
 */
async function commitSale(items, { orderId, folio, userId }, session) {
  const asignados = new Map();
  for (const it of items) {
    const r = await StockLevel.updateOne(
      { sku: it.sku, warehouse_id: it.warehouse_id, reservado: { $gte: it.cantidad } },
      { $inc: { reservado: -it.cantidad } },
      { session },
    );
    if (r.modifiedCount !== 1) throw conflict('RESERVA_INCONSISTENTE', `La reserva de ${it.sku} no coincide`);

    const serials = await SerialUnit.find({ sku: it.sku, warehouse_id: it.warehouse_id, estado: 'disponible' })
      .sort({ created_at: 1 }).limit(it.cantidad).session(session);
    for (const s of serials) {
      s.estado = 'vendido';
      s.order_id = orderId;
      s.order_item_id = it._id;
      await s.save({ session });
    }
    asignados.set(String(it._id), serials.map((s) => s.imei));

    await StockMovement.create([{
      sku: it.sku, product_id: it.product_id, warehouse_id: it.warehouse_id,
      tipo: 'venta', cantidad: -it.cantidad, referencia: folio, user_id: userId || null,
    }], { session });
  }
  return asignados;
}

/**
 * Regresa unidades vendidas al inventario (cancelación de pedido pagado o
 * devolución recibida).
 * @param {{sku, cantidad, warehouse_id, product_id, imeis?}[]} items
 * @param {{referencia:string, userId?:any, estadoSerial?:'disponible'|'devuelto'}} ref
 */
async function restock(items, { referencia, userId, estadoSerial = 'disponible' }, session) {
  for (const it of items) {
    await StockLevel.updateOne(
      { sku: it.sku, warehouse_id: it.warehouse_id },
      { $inc: { disponible: estadoSerial === 'disponible' ? it.cantidad : 0 }, $setOnInsert: { product_id: it.product_id } },
      { upsert: true, session },
    );
    if (it.imeis?.length) {
      await SerialUnit.updateMany(
        { imei: { $in: it.imeis } },
        estadoSerial === 'disponible'
          ? { estado: 'disponible', order_id: null, order_item_id: null }
          : { estado: 'devuelto' },
        { session },
      );
    }
    await StockMovement.create([{
      sku: it.sku, product_id: it.product_id, warehouse_id: it.warehouse_id,
      tipo: 'devolucion', cantidad: estadoSerial === 'disponible' ? it.cantidad : 0, referencia, user_id: userId || null,
    }], { session });
  }
}

/** Asigna un IMEI concreto a una línea (cuando el almacén escanea al preparar). */
async function assignSerial({ imei, sku, warehouseId, orderId, orderItemId }, session) {
  const s = await SerialUnit.findOne({ imei }).session(session);
  if (!s) throw notFound('IMEI');
  if (s.sku !== sku) throw conflict('IMEI_NO_CORRESPONDE', `El IMEI es de ${s.sku}, no de ${sku}`);
  if (String(s.order_item_id) === String(orderItemId)) return s;
  if (s.estado !== 'disponible') throw conflict('IMEI_NO_DISPONIBLE', `El IMEI está ${s.estado}`);
  if (String(s.warehouse_id) !== String(warehouseId)) throw conflict('IMEI_OTRO_ALMACEN', 'El IMEI está en otro almacén');
  s.estado = 'vendido';
  s.order_id = orderId;
  s.order_item_id = orderItemId;
  await s.save({ session });
  return s;
}

// ─── Movimientos manuales ─────────────────────────────────────────────────

/**
 * entrada (+), ajuste (±) o traspaso (origen → destino). Siempre en
 * transacción y nunca deja stock negativo.
 */
async function createMovement(actor, { tipo, sku, warehouse_id, warehouse_destino_id, cantidad, referencia }) {
  const found = await catalog().findBySku(sku);
  if (!found) throw notFound('SKU');
  const product_id = found.product._id;
  const ws = [warehouse_id, warehouse_destino_id].filter(Boolean);
  if ((await Warehouse.countDocuments({ _id: { $in: ws } })) !== new Set(ws.map(String)).size) throw notFound('Almacén');
  if (tipo === 'traspaso' && String(warehouse_id) === String(warehouse_destino_id)) {
    throw badRequest('El almacén destino debe ser distinto al de origen');
  }
  sku = found.variant.sku;

  return withTransaction(async (session) => {
    const movs = [];
    const base = { sku, product_id, referencia, user_id: actor.id };
    if (tipo === 'entrada' || tipo === 'ajuste') {
      const delta = tipo === 'entrada' ? Math.abs(cantidad) : cantidad;
      if (delta < 0) {
        const r = await StockLevel.updateOne(
          { sku, warehouse_id, disponible: { $gte: -delta } }, { $inc: { disponible: delta } }, { session },
        );
        if (!r.modifiedCount) throw stockInsuficiente(sku, -delta, await disponibleEn(sku, warehouse_id, session));
      } else {
        await StockLevel.updateOne(
          { sku, warehouse_id }, { $inc: { disponible: delta }, $setOnInsert: { product_id } }, { upsert: true, session },
        );
      }
      movs.push({ ...base, tipo, warehouse_id, cantidad: delta });
    } else if (tipo === 'traspaso') {
      const n = Math.abs(cantidad);
      const r = await StockLevel.updateOne(
        { sku, warehouse_id, disponible: { $gte: n } }, { $inc: { disponible: -n } }, { session },
      );
      if (!r.modifiedCount) throw stockInsuficiente(sku, n, await disponibleEn(sku, warehouse_id, session));
      await StockLevel.updateOne(
        { sku, warehouse_id: warehouse_destino_id }, { $inc: { disponible: n }, $setOnInsert: { product_id } },
        { upsert: true, session },
      );
      // Los IMEI disponibles se mueven con el traspaso (los más antiguos primero).
      const serials = await SerialUnit.find({ sku, warehouse_id, estado: 'disponible' }).sort({ created_at: 1 }).limit(n).session(session);
      if (serials.length) {
        await SerialUnit.updateMany({ _id: { $in: serials.map((s) => s._id) } }, { warehouse_id: warehouse_destino_id }, { session });
      }
      movs.push({ ...base, tipo, warehouse_id, cantidad: -n }, { ...base, tipo, warehouse_id: warehouse_destino_id, cantidad: n });
    } else {
      throw badRequest('tipo debe ser entrada, ajuste o traspaso');
    }
    return StockMovement.create(movs, { session, ordered: true });
  });
}

async function disponibleEn(sku, warehouse_id, session) {
  const l = await StockLevel.findOne({ sku, warehouse_id }).session(session).lean();
  return l ? l.disponible : 0;
}

// ─── IMEI ─────────────────────────────────────────────────────────────────

/** IMEI válido: 15 dígitos y dígito verificador Luhn. */
function isValidImei(imei) {
  if (!/^\d{15}$/.test(imei)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(imei[14 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * Alta de IMEI en lote. Todo o nada: si alguno es inválido → 422; si alguno
 * ya existe o se repite → 409. Cada IMEI suma 1 al stock disponible.
 */
async function registerSerials(actor, { sku, warehouse_id, imeis, referencia }) {
  const found = await catalog().findBySku(sku);
  if (!found) throw notFound('SKU');
  if (!(await Warehouse.exists({ _id: warehouse_id }))) throw notFound('Almacén');
  sku = found.variant.sku;
  const list = imeis.map((x) => String(x).trim());

  const invalidos = list.filter((x) => !isValidImei(x));
  if (invalidos.length) {
    const { unprocessable } = require('../../utils/errors');
    throw unprocessable('IMEI_INVALIDO', 'Hay IMEI con formato o dígito verificador inválido', { imeis: invalidos });
  }
  const repetidos = list.filter((x, i) => list.indexOf(x) !== i);
  const existentes = (await SerialUnit.find({ imei: { $in: list } }).select('imei').lean()).map((s) => s.imei);
  if (repetidos.length || existentes.length) {
    throw conflict('IMEI_DUPLICADO', 'Hay IMEI repetidos o ya registrados', { imeis: [...new Set([...repetidos, ...existentes])] });
  }

  return withTransaction(async (session) => {
    const product_id = found.product._id;
    const created = await SerialUnit.insertMany(
      list.map((imei) => ({ imei, sku, product_id, warehouse_id })), { session },
    );
    await StockLevel.updateOne(
      { sku, warehouse_id }, { $inc: { disponible: created.length }, $setOnInsert: { product_id } },
      { upsert: true, session },
    );
    await StockMovement.insertMany(created.map((s) => ({
      sku, product_id, warehouse_id, tipo: 'entrada', cantidad: 1,
      referencia: referencia || 'alta IMEI', user_id: actor.id, serial_unit_id: s._id,
    })), { session });
    return created;
  });
}

async function getSerial(imei) {
  const s = await SerialUnit.findOne({ imei }).populate('warehouse_id', 'nombre tipo').lean();
  if (!s) throw notFound('IMEI');
  const historial = await StockMovement.find({ serial_unit_id: s._id }).sort({ created_at: 1 }).lean();
  return { ...s, historial };
}

// ─── Consultas admin ──────────────────────────────────────────────────────

async function listStock(q, { skip, limit }) {
  const umbral = await getConfigInt('stock_bajo_umbral');
  const match = {};
  if (q.warehouse_id) match.warehouse_id = require('../../utils/ids').oid(q.warehouse_id);
  if (q.sku) match.sku = new RegExp(escapeRegex(String(q.sku).toUpperCase()));
  const bajoExpr = { $lte: ['$disponible', { $max: ['$stock_minimo', umbral] }] };
  const pipeline = [
    { $match: match },
    { $addFields: { stock_bajo: bajoExpr } },
    ...(q.bajo === 'true' ? [{ $match: { stock_bajo: true } }] : []),
    { $sort: { stock_bajo: -1, disponible: 1, sku: 1 } },
    { $facet: { data: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } },
  ];
  const [res] = await StockLevel.aggregate(pipeline);
  const skus = res.data.map((r) => r.sku);
  const info = await catalog().findManyBySku(skus);
  const whs = new Map((await Warehouse.find().lean()).map((w) => [String(w._id), w.nombre]));
  const data = res.data.map((r) => {
    const f = info.get(r.sku);
    return {
      ...r,
      almacen: whs.get(String(r.warehouse_id)),
      descripcion: f ? catalog().variantLabel(f.product, f.variant) : null,
    };
  });
  return { data, total: res.total[0]?.n || 0, umbral };
}

async function listMovements(q, { skip, limit }) {
  const filter = {};
  if (q.sku) filter.sku = String(q.sku).toUpperCase();
  if (q.warehouse_id) filter.warehouse_id = q.warehouse_id;
  if (q.tipo) filter.tipo = q.tipo;
  const [data, total] = await Promise.all([
    StockMovement.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
    StockMovement.countDocuments(filter),
  ]);
  return { data, total };
}

const listWarehouses = () => Warehouse.find().sort({ nombre: 1 }).lean();
const createWarehouse = (data) => Warehouse.create(data);
async function updateWarehouse(id, data) {
  const w = await Warehouse.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!w) throw notFound('Almacén');
  return w;
}

/** Valor del inventario a costo y a precio de venta, por SKU (reportes). */
async function stockTotalsBySku() {
  return StockLevel.aggregate([
    { $group: { _id: '$sku', product_id: { $first: '$product_id' }, disponible: { $sum: '$disponible' }, reservado: { $sum: '$reservado' } } },
  ]);
}

module.exports = {
  availabilityBySku, availabilityByProduct, reserve, release, commitSale, restock, assignSerial,
  createMovement, isValidImei, registerSerials, getSerial, listStock, listMovements,
  listWarehouses, createWarehouse, updateWarehouse, stockTotalsBySku,
};
