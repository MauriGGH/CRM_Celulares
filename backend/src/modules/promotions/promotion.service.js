/**
 * Promociones y cupones. El cálculo vive en utils/promociones.js (motor
 * portado de Mochi Matcha); aquí está el CRUD y el cálculo de precios del
 * carrito que comparten carrito y checkout.
 */
const Promotion = require('./promotion.model');
const { aplicarPromociones } = require('../../utils/promociones');
const { toCents } = require('../../utils/money');
const { notFound, unprocessable, badRequest } = require('../../utils/errors');
const { getConfig } = require('../../utils/configuracion');
const { logAccion } = require('../../utils/auditoria');

const getById = (id) => Promotion.findById(id).lean();

/** Cupón vigente por código, o 422 CUPON_INVALIDO. */
async function findCoupon(codigo) {
  const ahora = new Date();
  const p = await Promotion.findOne({
    codigo: String(codigo).trim().toUpperCase(), activa: true,
    fecha_inicio: { $lte: ahora }, fecha_fin: { $gte: ahora },
  }).lean();
  if (!p || (p.usos_maximos != null && p.usos >= p.usos_maximos)) {
    throw unprocessable('CUPON_INVALIDO', 'El cupón no existe, venció o se agotó');
  }
  return p;
}

/**
 * Calcula descuento, envío y total.
 * @param {{sku:string, product_id:any, cantidad:number, precio_cents:number}[]} lines
 * @param {{codigo?:string|null, promocionId?:string|null}} opts
 */
async function priceLines(lines, { codigo = null, promocionId = null } = {}) {
  const carrito = lines.map((l) => ({
    sku: l.sku,
    product_id: String(l.product_id),
    cantidad: l.cantidad,
    subtotal: (l.precio_cents * l.cantidad) / 100,
  }));
  const { carrito: ajustado, aplicadas, elegibles } = await aplicarPromociones(carrito, { codigo, promocionId });

  const items = lines.map((l, i) => {
    const subtotal = l.precio_cents * l.cantidad;
    const conDescuento = Math.min(subtotal, Math.max(0, Math.round(ajustado[i].subtotal * 100)));
    return { ...l, subtotal_cents: subtotal, descuento_cents: subtotal - conDescuento };
  });
  const subtotal = items.reduce((s, x) => s + x.subtotal_cents, 0);
  const descuento = items.reduce((s, x) => s + x.descuento_cents, 0);
  const neto = subtotal - descuento;
  const gratisDesde = toCents(await getConfig('envio_gratis_desde'));
  const envio = items.length === 0 || (gratisDesde != null && neto >= gratisDesde) ? 0 : toCents(await getConfig('costo_envio'));

  const resumen = (p) => ({ id: p.id, nombre: p.nombre, codigo: p.codigo || null, tipo_descuento: p.tipo_descuento });
  return {
    items,
    subtotal_cents: subtotal,
    descuento_cents: descuento,
    envio_cents: envio,
    total_cents: neto + envio,
    promocion: aplicadas[0] ? resumen(aplicadas[0]) : null,
    promociones_elegibles: elegibles.map(resumen),
  };
}

/** Sube el contador de usos (al pagar). */
const incrementUse = (id, session) => Promotion.updateOne({ _id: id }, { $inc: { usos: 1 } }, { session });

// ─── Admin ────────────────────────────────────────────────────────────────

async function list(q, { skip, limit }) {
  const filter = {};
  if (q.activa !== undefined) filter.activa = q.activa === 'true';
  if (q.vigente === 'true') { const now = new Date(); filter.fecha_inicio = { $lte: now }; filter.fecha_fin = { $gte: now }; }
  const [data, total] = await Promise.all([
    Promotion.find(filter).sort({ orden: 1, fecha_inicio: -1 }).skip(skip).limit(limit),
    Promotion.countDocuments(filter),
  ]);
  return { data, total };
}

function checkRules(p) {
  if (new Date(p.fecha_fin) < new Date(p.fecha_inicio)) throw badRequest('fecha_fin debe ser posterior a fecha_inicio');
  if (p.tipo_descuento === 'Porcentaje' && (p.valor_descuento <= 0 || p.valor_descuento > 100)) {
    throw badRequest('El porcentaje debe estar entre 0 y 100');
  }
  if (p.tipo_descuento === 'Lleva X paga Y' && !(p.cantidad_minima > p.valor_descuento)) {
    throw badRequest('En "Lleva X paga Y", cantidad_minima (X) debe ser mayor que valor_descuento (Y)');
  }
}

async function create(actor, data) {
  const p = new Promotion(data);
  checkRules(p);
  await p.save();
  await logAccion(actor.id, 'promocion.crear', { nombre: p.nombre, codigo: p.codigo }, { entidad: 'promotion', entidadId: p.id });
  return p;
}

async function update(actor, id, data) {
  const p = await Promotion.findById(id);
  if (!p) throw notFound('Promoción');
  p.set(data);
  checkRules(p);
  await p.save();
  await logAccion(actor.id, 'promocion.editar', { campos: Object.keys(data) }, { entidad: 'promotion', entidadId: p.id });
  return p;
}

async function remove(actor, id) {
  const p = await Promotion.findById(id);
  if (!p) throw notFound('Promoción');
  // Si ya se usó se desactiva para conservar la referencia en pedidos.
  if (p.usos > 0) { p.activa = false; await p.save(); } else { await p.deleteOne(); }
  await logAccion(actor.id, 'promocion.eliminar', { nombre: p.nombre }, { entidad: 'promotion', entidadId: p.id });
}

module.exports = { getById, findCoupon, priceLines, incrementUse, list, create, update, remove };
