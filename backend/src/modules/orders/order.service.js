/**
 * Pedidos: checkout con reserva de stock, pago, transiciones de estado,
 * envíos, devoluciones y expiración de reservas.
 */
const Order = require('./order.model');
const Return = require('./return.model');
const Counter = require('../../utils/counter.model');
const cartSvc = require('../cart/cart.service');
const users = require('../users/user.service');
const inventory = require('../inventory/inventory.service');
const promotions = require('../promotions/promotion.service');
const config = require('../../config/env');
const { withTransaction } = require('../../utils/transaction');
const { enqueue } = require('../../utils/queue');
const { toDecimal, toCents, fromCents } = require('../../utils/money');
const { logAccion } = require('../../utils/auditoria');
const { getConfigInt } = require('../../utils/configuracion');
const { notFound, conflict, forbidden, unprocessable } = require('../../utils/errors');
const logger = require('../../utils/logger');

/** Transiciones permitidas desde el panel. `enviado` se marca con POST /shipment. */
const TRANSITIONS = {
  pendiente_pago: ['cancelado'],
  pagado: ['preparando', 'cancelado'],
  preparando: ['enviado', 'cancelado'],
  enviado: ['entregado'],
  entregado: ['reembolsado'],
  cancelado: [],
  reembolsado: [],
};

const cents = (d) => toCents(d?.toString() ?? 0);

async function nextFolio(session) {
  const seq = await Counter.next(`orders-${new Date().getUTCFullYear()}`, session);
  return `CEL-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
}

function snapshotAddress(a) {
  const { _id, created_at, updated_at, es_principal, ...rest } = a; // eslint-disable-line no-unused-vars
  return rest;
}

// ─── Checkout ─────────────────────────────────────────────────────────────

/**
 * Crea el pedido `pendiente_pago`, copia precios y dirección y aparta el
 * stock por RESERVA_MINUTOS (15 por defecto). Todo en una transacción:
 * si una sola línea no alcanza, no se reserva nada.
 */
async function checkout(user, { address_id, notas }) {
  const address = await users.getAddress(user.id, address_id);
  const order = await withTransaction(async (session) => {
    const cart = await cartSvc.getOrCreate(user.id, session);
    const { pricing, invalidas } = await cartSvc.build(cart);
    if (!cart.items.length) throw conflict('CARRITO_VACIO', 'El carrito está vacío');
    if (invalidas.length) {
      throw conflict('CARRITO_INVALIDO', 'Hay productos que ya no están a la venta', { skus: invalidas });
    }

    const reservas = await inventory.reserve(pricing.items.map((l) => ({ sku: l.sku, cantidad: l.cantidad })), session);
    const items = pricing.items.map((l, i) => ({
      sku: l.sku,
      product_id: l.product_id,
      warehouse_id: reservas[i].warehouse_id,
      nombre: l.descripcion,
      cantidad: l.cantidad,
      precio_unitario: toDecimal(l.precio_cents),
      descuento: toDecimal(l.descuento_cents),
      subtotal: toDecimal(l.subtotal_cents - l.descuento_cents),
      costo_unitario: toDecimal(l.costo_cents || 0),
    }));
    const [created] = await Order.create([{
      folio: await nextFolio(session),
      user_id: user.id,
      canal: 'online',
      estado: 'pendiente_pago',
      items,
      subtotal: toDecimal(pricing.subtotal_cents),
      descuento: toDecimal(pricing.descuento_cents),
      envio: toDecimal(pricing.envio_cents),
      total: toDecimal(pricing.total_cents),
      promotion_id: pricing.promocion?.id || null,
      shipping_address: snapshotAddress(address),
      reservado_hasta: new Date(Date.now() + config.reservaMinutos * 60_000),
      notas,
      status_history: [{ estado: 'pendiente_pago', user_id: user.id }],
    }], { session });
    await cartSvc.clear(user.id, session);
    return created;
  });

  await enqueue('reservations', 'expire', { orderId: String(order._id) }, {
    delay: config.reservaMinutos * 60_000 + 1000,
    jobId: `expire-${order._id}`,
  });
  return order;
}

// ─── Reservas vencidas ────────────────────────────────────────────────────

/** Cancela el pedido si sigue sin pagar y su reserva venció; libera el stock. */
async function expireReservation(orderId) {
  return withTransaction(async (session) => {
    const order = await Order.findOneAndUpdate(
      { _id: orderId, estado: 'pendiente_pago', reservado_hasta: { $lte: new Date() } },
      {
        estado: 'cancelado', motivo_cancelacion: 'reserva_expirada', cancelado_en: new Date(),
        $push: { status_history: { estado: 'cancelado', nota: 'reserva_expirada' } },
      },
      { new: true, session },
    );
    if (!order) return false;
    await inventory.release(order.items, session);
    return true;
  });
}

/** Barrido periódico (worker): cubre jobs perdidos o el modo inline. */
async function sweepExpired() {
  const vencidos = await Order.find({ estado: 'pendiente_pago', reservado_hasta: { $lte: new Date() } })
    .select('_id').limit(500).lean();
  let n = 0;
  for (const o of vencidos) if (await expireReservation(o._id)) n++;
  if (n) logger.info({ cancelados: n }, 'reservas vencidas liberadas');
  return n;
}

// ─── Pago ─────────────────────────────────────────────────────────────────

/**
 * Marca el pedido como pagado (dentro de la transacción del pago): lo
 * reservado sale del inventario, se registra la venta y se asignan IMEI.
 * @returns {Promise<{status:'pagado'|'ya_pagado'|'no_pagable', order}>}
 */
async function markPaid(orderId, session) {
  const order = await Order.findOneAndUpdate(
    { _id: orderId, estado: 'pendiente_pago' },
    { estado: 'pagado', pagado_en: new Date(), $push: { status_history: { estado: 'pagado' } } },
    { new: true, session },
  );
  if (!order) {
    const actual = await Order.findById(orderId).session(session);
    if (!actual) throw notFound('Pedido');
    const pagado = ['pagado', 'preparando', 'enviado', 'entregado'].includes(actual.estado);
    return { status: pagado ? 'ya_pagado' : 'no_pagable', order: actual };
  }
  const asignados = await inventory.commitSale(order.items, { orderId: order._id, folio: order.folio }, session);
  for (const it of order.items) it.imeis = asignados.get(String(it._id)) || [];
  await order.save({ session });
  if (order.promotion_id) await promotions.incrementUse(order.promotion_id, session);
  return { status: 'pagado', order };
}

/** Pedido del cliente listo para pagar; si no, 409 PEDIDO_NO_PAGABLE. */
async function getPayable(user, orderId) {
  const order = await Order.findById(orderId);
  if (!order || String(order.user_id) !== String(user.id)) throw notFound('Pedido');
  if (order.estado !== 'pendiente_pago') throw conflict('PEDIDO_NO_PAGABLE', `El pedido está ${order.estado}`);
  if (order.reservado_hasta < new Date()) throw conflict('RESERVA_VENCIDA', 'La reserva de stock venció; vuelve a hacer checkout');
  return order;
}

// ─── Cliente ──────────────────────────────────────────────────────────────

async function listMine(userId, { skip, limit }) {
  const filter = { user_id: userId };
  const [data, total] = await Promise.all([
    Order.find(filter).select('-status_history').sort({ created_at: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  return { data, total };
}

async function getMine(user, id) {
  const order = await Order.findById(id);
  if (!order || String(order.user_id) !== String(user.id)) throw notFound('Pedido');
  const returns = await Return.find({ order_id: order._id }).lean();
  return { ...order.toObject(), returns };
}

/** El cliente cancela antes de que se prepare. Si ya pagó, el pago queda por reembolsar. */
async function cancelByCustomer(user, id, motivo) {
  const order = await Order.findById(id);
  if (!order || String(order.user_id) !== String(user.id)) throw notFound('Pedido');
  if (!['pendiente_pago', 'pagado'].includes(order.estado)) {
    throw conflict('TRANSICION_INVALIDA', `No se puede cancelar un pedido ${order.estado}`);
  }
  return changeStatus({ id: user.id, rol: 'cliente' }, id, 'cancelado', motivo || 'cancelado_por_cliente');
}

// ─── Admin ────────────────────────────────────────────────────────────────

async function listAdmin(q, { skip, limit }) {
  const filter = {};
  if (q.estado) filter.estado = q.estado;
  if (q.folio) filter.folio = String(q.folio).toUpperCase();
  if (q.user_id) filter.user_id = q.user_id;
  if (q.desde || q.hasta) {
    filter.created_at = {};
    if (q.desde) filter.created_at.$gte = new Date(q.desde);
    if (q.hasta) filter.created_at.$lte = new Date(q.hasta);
  }
  const [data, total] = await Promise.all([
    Order.find(filter).populate('user_id', 'nombre email').sort({ created_at: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  return { data, total };
}

async function getAdmin(id) {
  const order = await Order.findById(id).populate('user_id', 'nombre email telefono');
  if (!order) throw notFound('Pedido');
  const returns = await Return.find({ order_id: order._id }).lean();
  return { ...order.toObject(), returns };
}

/**
 * Cambia el estado validando TRANSITIONS. Cancelar libera la reserva o
 * regresa el stock vendido; los pagos aprobados quedan `requiere_reembolso`.
 */
async function changeStatus(actor, id, estado, nota) {
  const result = await withTransaction(async (session) => {
    const order = await Order.findById(id).session(session);
    if (!order) throw notFound('Pedido');
    const desde = order.estado;
    if (!TRANSITIONS[desde]?.includes(estado)) {
      throw conflict('TRANSICION_INVALIDA', `No se puede pasar de ${desde} a ${estado}`, { desde, hacia: estado, permitidas: TRANSITIONS[desde] });
    }
    if (estado === 'enviado' && !order.shipment) {
      throw conflict('ENVIO_REQUERIDO', 'Registra la guía con POST /admin/orders/:id/shipment');
    }
    if (estado === 'cancelado') {
      if (desde === 'pendiente_pago') await inventory.release(order.items, session);
      else await inventory.restock(order.items, { referencia: order.folio, userId: actor.id }, session);
      if (desde !== 'pendiente_pago') {
        const payments = require('../payments/payment.service');
        await payments.flagRefund(order._id, session);
      }
      order.cancelado_en = new Date();
      order.motivo_cancelacion = nota;
    }
    if (estado === 'entregado') {
      order.entregado_en = new Date();
      if (order.shipment) { order.shipment.estado = 'entregado'; order.shipment.entregado_en = new Date(); }
    }
    order.estado = estado;
    order.status_history.push({ estado, user_id: actor.id, nota });
    await order.save({ session });
    await logAccion(actor.id, 'pedido.estado', { folio: order.folio, desde, hacia: estado, nota }, { entidad: 'order', entidadId: order.id, session });
    return order;
  });
  return result;
}

async function addShipment(actor, id, { paqueteria, guia }) {
  const order = await withTransaction(async (session) => {
    const o = await Order.findById(id).session(session);
    if (!o) throw notFound('Pedido');
    if (!['pagado', 'preparando'].includes(o.estado)) {
      throw conflict('TRANSICION_INVALIDA', `No se puede enviar un pedido ${o.estado}`);
    }
    o.shipment = { paqueteria, guia, estado: 'enviado', enviado_en: new Date() };
    o.status_history.push({ estado: 'enviado', user_id: actor.id, nota: `${paqueteria} ${guia}` });
    o.estado = 'enviado';
    await o.save({ session });
    await logAccion(actor.id, 'pedido.envio', { folio: o.folio, paqueteria, guia }, { entidad: 'order', entidadId: o.id, session });
    return o;
  });
  await enqueue('emails', 'order-shipped', { orderId: String(order._id) });
  return order;
}

/** Asigna IMEI escaneados a las líneas que no los tienen completos. */
async function assignSerials(actor, id, asignaciones) {
  return withTransaction(async (session) => {
    const order = await Order.findById(id).session(session);
    if (!order) throw notFound('Pedido');
    if (!['pagado', 'preparando'].includes(order.estado)) throw conflict('TRANSICION_INVALIDA', `El pedido está ${order.estado}`);
    for (const { order_item_id, imei } of asignaciones) {
      const item = order.items.id(order_item_id);
      if (!item) throw notFound('Línea del pedido');
      if (item.imeis.includes(imei)) continue;
      if (item.imeis.length >= item.cantidad) {
        throw conflict('IMEI_COMPLETOS', `La línea ${item.sku} ya tiene sus ${item.cantidad} IMEI`);
      }
      await inventory.assignSerial({ imei, sku: item.sku, warehouseId: item.warehouse_id, orderId: order._id, orderItemId: item._id }, session);
      item.imeis.push(imei);
    }
    await order.save({ session });
    await logAccion(actor.id, 'pedido.imei', { folio: order.folio, asignaciones }, { entidad: 'order', entidadId: order.id, session });
    return order;
  });
}

// ─── Devoluciones y garantías ─────────────────────────────────────────────

const RETURN_TRANSITIONS = {
  solicitada: ['aprobada', 'rechazada'],
  aprobada: ['recibida', 'rechazada'],
  recibida: ['reembolsada'],
  rechazada: [],
  reembolsada: [],
};

async function requestReturn(user, orderId, { order_item_id, motivo, tipo, cantidad = 1, imei }) {
  const order = await Order.findById(orderId);
  if (!order || String(order.user_id) !== String(user.id)) throw notFound('Pedido');
  if (order.estado !== 'entregado') throw conflict('PEDIDO_NO_ENTREGADO', 'Solo se aceptan devoluciones de pedidos entregados');
  const item = order.items.id(order_item_id);
  if (!item) throw notFound('Línea del pedido');

  const dias = (Date.now() - new Date(order.entregado_en || order.updated_at).getTime()) / 86_400_000;
  if (tipo === 'devolucion' && dias > await getConfigInt('dias_devolucion', 30)) {
    throw unprocessable('FUERA_DE_PLAZO', 'El plazo de devolución terminó; puedes solicitar garantía');
  }
  if (tipo === 'garantia') {
    const catalog = require('../catalog/catalog.service');
    const f = await catalog.findBySku(item.sku);
    const meses = f?.product.garantia_meses ?? 12;
    if (dias > meses * 30.5) throw unprocessable('GARANTIA_VENCIDA', 'La garantía del equipo venció');
  }
  const abiertas = await Return.find({ order_id: order._id, order_item_id: item._id, estado: { $ne: 'rechazada' } }).lean();
  const yaDevueltas = abiertas.reduce((s, r) => s + r.cantidad, 0);
  if (yaDevueltas + cantidad > item.cantidad) throw conflict('DEVOLUCION_DUPLICADA', 'Ya hay una solicitud para esas piezas');

  if (imei && !item.imeis.includes(imei)) throw unprocessable('IMEI_NO_CORRESPONDE', 'El IMEI no pertenece a este pedido');
  const yaUsados = abiertas.map((r) => r.imei).filter(Boolean);
  const imeiDevuelto = imei || item.imeis.find((x) => !yaUsados.includes(x)) || null;
  return Return.create({
    order_id: order._id, order_item_id: item._id, sku: item.sku, user_id: user.id, cantidad, motivo, tipo, imei: imeiDevuelto,
  });
}

async function listReturns(q, { skip, limit }) {
  const filter = {};
  if (q.estado) filter.estado = q.estado;
  if (q.tipo) filter.tipo = q.tipo;
  const [data, total] = await Promise.all([
    Return.find(filter).populate('order_id', 'folio estado').sort({ created_at: -1 }).skip(skip).limit(limit),
    Return.countDocuments(filter),
  ]);
  return { data, total };
}

/**
 * Avanza la devolución. Al recibirla, una devolución regresa la pieza a
 * stock (si `reintegrar_stock`) y una garantía marca el IMEI `devuelto`.
 * Si todas las piezas del pedido quedan reembolsadas, el pedido pasa a `reembolsado`.
 */
async function updateReturn(actor, id, { estado, resolucion, reintegrar_stock }) {
  return withTransaction(async (session) => {
    const ret = await Return.findById(id).session(session);
    if (!ret) throw notFound('Devolución');
    if (!RETURN_TRANSITIONS[ret.estado].includes(estado)) {
      throw conflict('TRANSICION_INVALIDA', `No se puede pasar de ${ret.estado} a ${estado}`, { permitidas: RETURN_TRANSITIONS[ret.estado] });
    }
    if (reintegrar_stock !== undefined) ret.reintegrar_stock = reintegrar_stock;
    const order = await Order.findById(ret.order_id).session(session);
    const item = order.items.id(ret.order_item_id);

    if (estado === 'recibida') {
      const vuelveAStock = ret.tipo === 'devolucion' && ret.reintegrar_stock;
      await inventory.restock([{
        sku: item.sku, cantidad: ret.cantidad, warehouse_id: item.warehouse_id, product_id: item.product_id,
        imeis: ret.imei ? [ret.imei] : [],
      }], { referencia: `${order.folio} devolución`, userId: actor.id, estadoSerial: vuelveAStock ? 'disponible' : 'devuelto' }, session);
    }
    ret.estado = estado;
    if (resolucion) ret.resolucion = resolucion;
    await ret.save({ session });

    if (estado === 'reembolsada') {
      const todas = await Return.find({ order_id: order._id, estado: 'reembolsada' }).session(session).lean();
      const devueltas = todas.reduce((s, r) => s + r.cantidad, 0);
      const piezas = order.items.reduce((s, it) => s + it.cantidad, 0);
      if (devueltas >= piezas && order.estado === 'entregado') {
        order.estado = 'reembolsado';
        order.status_history.push({ estado: 'reembolsado', user_id: actor.id, nota: 'devolución total' });
        await order.save({ session });
      }
    }
    await logAccion(actor.id, 'devolucion.estado', { folio: order.folio, estado }, { entidad: 'return', entidadId: ret.id, session });
    return ret;
  });
}

// ─── Correos (cola `emails`) ──────────────────────────────────────────────

async function emailFor(orderId, kind) {
  const { sendMail } = require('../../utils/mailer');
  const order = await Order.findById(orderId).populate('user_id', 'email nombre').lean();
  if (!order?.user_id?.email) return;
  const lineas = order.items.map((i) => `- ${i.nombre} x${i.cantidad}: $${fromCents(cents(i.subtotal))}`).join('\n');
  if (kind === 'confirmed') {
    await sendMail({
      to: order.user_id.email,
      subject: `Pedido ${order.folio} confirmado`,
      text: `Hola ${order.user_id.nombre}, recibimos tu pago.\n\n${lineas}\n\nTotal: $${fromCents(cents(order.total))} MXN`,
    });
  } else {
    const s = order.shipment;
    await sendMail({
      to: order.user_id.email,
      subject: `Tu pedido ${order.folio} va en camino`,
      text: `Hola ${order.user_id.nombre}, enviamos tu pedido con ${s?.paqueteria}, guía ${s?.guia}.`,
    });
  }
}

function assertOwner(user, order) {
  if (String(order.user_id) !== String(user.id)) throw forbidden();
}

module.exports = {
  TRANSITIONS, RETURN_TRANSITIONS, checkout, expireReservation, sweepExpired, markPaid, getPayable,
  listMine, getMine, cancelByCustomer, listAdmin, getAdmin, changeStatus, addShipment, assignSerials,
  requestReturn, listReturns, updateReturn, emailFor, assertOwner,
};
