/**
 * Motor de aplicación de promociones — portado de Mochi Matcha (Sequelize →
 * Mongoose). La lógica de los 5 tipos se conserva; los ítems ahora son
 * variantes (`sku`) agrupadas por `product_id`.
 *
 * Soporta 5 tipos canónicos de `tipo_descuento`:
 *   - "Porcentaje"
 *   - "Monto fijo"
 *   - "2x1"
 *   - "Combo precio fijo"
 *   - "Lleva X paga Y"
 *
 * Regla de negocio: máximo UNA promo por pedido.
 * Si hay varias elegibles y no se especifica `promocion_id`, no se aplica ninguna
 * y el frontend recibe la lista para que el cliente elija.
 */
const Promotion = require('../modules/promotions/promotion.model');

const TD_PORCENTAJE = 'Porcentaje';
const TD_MONTO_FIJO = 'Monto fijo';
const TD_2X1        = '2x1';
const TD_COMBO      = 'Combo precio fijo';
const TD_LLEVA_X    = 'Lleva X paga Y';

// ─── Helpers numéricos (evitamos floats donde sea relevante) ────────────────
const r = (n) => Number(parseFloat(n).toFixed(2));

/** ¿La promoción está vigente hoy (según días_semana)? */
function aplicaHoy(promo, fecha = new Date()) {
  const dias = (promo.dias_semana || '').toString().trim();
  if (!dias) return true;
  const permitidos = new Set(
    dias.split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n))
  );
  if (!permitidos.size) return true;
  // Django weekday(): 0=lunes ... 6=domingo. JS getDay(): 0=domingo ... 6=sábado.
  const jsDay = fecha.getDay();
  const django = (jsDay + 6) % 7;
  return permitidos.has(django);
}

/**
 * Carga las promos activas y vigentes. Las automáticas (sin código) siempre;
 * un cupón solo si `codigo` coincide. Se excluyen las que agotaron usos.
 * @param {string|null} codigo
 */
async function cargarPromosActivas(codigo = null) {
  const ahora = new Date();
  const promos = await Promotion.find({
    activa: true,
    fecha_inicio: { $lte: ahora },
    fecha_fin: { $gte: ahora },
    $or: [{ codigo: null }, { codigo: { $exists: false } }, ...(codigo ? [{ codigo: String(codigo).toUpperCase() }] : [])],
  }).sort({ orden: 1, fecha_inicio: -1 }).lean();
  return promos
    .filter((p) => p.usos_maximos == null || p.usos < p.usos_maximos)
    .map((p) => ({ ...p, id: String(p._id) }));
}

function idsDe(ids) {
  return new Set((ids || []).map(String));
}

/** ¿La promo es elegible para este carrito? */
function promoEsElegible(promo, carrito) {
  if (!promo.tipo_descuento) return false;
  const idsAplicables   = idsDe(promo.productos_aplicables);
  const idsBeneficiados = idsDe(promo.productos_beneficiados);
  const idsCarrito = new Set(carrito.map((i) => i.product_id));

  if (promo.aplicacion === 'total') return idsCarrito.size > 0;

  // Dos grupos distintos: aplicables = disparador, beneficiados = descuento.
  if (idsAplicables.size && idsBeneficiados.size) {
    const interA = [...idsAplicables].some((id) => idsCarrito.has(id));
    const interB = [...idsBeneficiados].some((id) => idsCarrito.has(id));
    return interA && interB;
  }

  const requiereTodos =
    promo.tipo_descuento === TD_COMBO ||
    promo.requiere_todos_productos === true;

  if (requiereTodos) {
    if (!idsAplicables.size) return false;
    return [...idsAplicables].every((id) => idsCarrito.has(id));
  }

  if (!idsAplicables.size) return false;
  return [...idsAplicables].some((id) => idsCarrito.has(id));
}

/** Promos vigentes hoy y elegibles para el carrito actual. */
async function promosElegibles(carrito, codigo = null) {
  const promos = await cargarPromosActivas(codigo);
  return promos.filter((p) => aplicaHoy(p) && promoEsElegible(p, carrito));
}

// ─── Implementaciones por tipo ──────────────────────────────────────────────

function aplicarPorcentaje(carrito, promo, idsAplicables, aplicadas) {
  if (!promo.valor_descuento) return;
  const pct = parseFloat(promo.valor_descuento) / 100;
  const idsBeneficiados = idsDe(promo.productos_beneficiados);
  const idsDescuento = (idsAplicables.size && idsBeneficiados.size)
    ? new Set([...idsAplicables, ...idsBeneficiados])
    : idsAplicables;
  let afectados = false;
  for (const item of carrito) {
    if (idsDescuento.size && !idsDescuento.has(item.product_id)) continue;
    const desc = parseFloat(item.subtotal) * pct;
    item.subtotal = r(parseFloat(item.subtotal) - desc);
    item.promocion_id = promo.id;
    afectados = true;
  }
  if (afectados && !aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicarMontoPorItem(carrito, promo, idsAplicables, aplicadas) {
  if (!promo.valor_descuento) return;
  const descuento = parseFloat(promo.valor_descuento);
  const idsBeneficiados = idsDe(promo.productos_beneficiados);
  const idsDescuento = (idsAplicables.size && idsBeneficiados.size)
    ? new Set([...idsAplicables, ...idsBeneficiados])
    : idsAplicables;
  let afectados = false;
  for (const item of carrito) {
    if (idsDescuento.size && !idsDescuento.has(item.product_id)) continue;
    const nuevo = Math.max(0, parseFloat(item.subtotal) - descuento);
    item.subtotal = r(nuevo);
    item.promocion_id = promo.id;
    afectados = true;
  }
  if (afectados && !aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicarMontoTotal(carrito, promo, aplicadas) {
  if (!promo.valor_descuento) return;
  const total = carrito.reduce((acc, i) => acc + parseFloat(i.subtotal), 0);
  if (total <= 0) return;
  const descTotal = parseFloat(promo.valor_descuento);
  const factor = Math.max(0, (total - descTotal) / total);
  for (const item of carrito) {
    item.subtotal = r(parseFloat(item.subtotal) * factor);
    item.promocion_id = promo.id;
  }
  if (!aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicar2x1(carrito, promo, idsAplicables, aplicadas) {
  const idsBeneficiados = idsDe(promo.productos_beneficiados);
  const idsDescuento = (idsAplicables.size && idsBeneficiados.size)
    ? new Set([...idsAplicables, ...idsBeneficiados])
    : idsAplicables;
  let afectados = false;
  for (const item of carrito) {
    if (idsDescuento.size && !idsDescuento.has(item.product_id)) continue;
    const cant = item.cantidad;
    if (cant < 2) continue;
    const pares = Math.floor(cant / 2);
    const precioUnit = parseFloat(item.subtotal) / cant;
    const descuento = precioUnit * pares;
    item.subtotal = r(parseFloat(item.subtotal) - descuento);
    item.promocion_id = promo.id;
    afectados = true;
  }
  if (afectados && !aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicarLlevaXPagaY(carrito, promo, idsAplicables, aplicadas) {
  if (!promo.cantidad_minima || !promo.valor_descuento) return;
  const x = parseInt(promo.cantidad_minima, 10);
  const y = parseInt(promo.valor_descuento, 10);
  if (x <= y || x < 2) return;
  const idsBeneficiados = idsDe(promo.productos_beneficiados);
  const idsDescuento = (idsAplicables.size && idsBeneficiados.size)
    ? new Set([...idsAplicables, ...idsBeneficiados])
    : idsAplicables;
  let afectados = false;
  for (const item of carrito) {
    if (idsDescuento.size && !idsDescuento.has(item.product_id)) continue;
    const cant = item.cantidad;
    if (cant < x) continue;
    const grupos = Math.floor(cant / x);
    const unidadesGratis = grupos * (x - y);
    const precioUnit = parseFloat(item.subtotal) / cant;
    const descuento = precioUnit * unidadesGratis;
    item.subtotal = r(parseFloat(item.subtotal) - descuento);
    item.promocion_id = promo.id;
    afectados = true;
  }
  if (afectados && !aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicarCombo(carrito, promo, idsAplicables, idsBeneficiados, aplicadas) {
  if (!promo.valor_descuento) return;
  const idsCarrito = new Set(carrito.map((i) => i.product_id));
  if (idsAplicables.size && ![...idsAplicables].every((id) => idsCarrito.has(id))) return;

  const targetIds = idsBeneficiados.size ? idsBeneficiados : idsAplicables;
  const itemsTarget = carrito.filter((i) => targetIds.has(i.product_id));
  if (!itemsTarget.length) return;

  const totalActual = itemsTarget.reduce((acc, i) => acc + parseFloat(i.subtotal), 0);
  if (totalActual <= 0) return;

  const precioCombo = parseFloat(promo.valor_descuento);
  const factor = precioCombo / totalActual;
  for (const item of itemsTarget) {
    item.subtotal = r(parseFloat(item.subtotal) * factor);
    item.promocion_id = promo.id;
  }
  if (!aplicadas.includes(promo)) aplicadas.push(promo);
}

function aplicarUna(carrito, promo, idsAplicables, aplicadas) {
  const tipo = promo.tipo_descuento;
  if (tipo === TD_PORCENTAJE) {
    aplicarPorcentaje(carrito, promo, idsAplicables, aplicadas);
  } else if (tipo === TD_MONTO_FIJO) {
    if (promo.aplicacion === 'total') aplicarMontoTotal(carrito, promo, aplicadas);
    else aplicarMontoPorItem(carrito, promo, idsAplicables, aplicadas);
  } else if (tipo === TD_2X1) {
    aplicar2x1(carrito, promo, idsAplicables, aplicadas);
  } else if (tipo === TD_LLEVA_X) {
    aplicarLlevaXPagaY(carrito, promo, idsAplicables, aplicadas);
  } else if (tipo === TD_COMBO) {
    const idsBeneficiados = idsDe(promo.productos_beneficiados);
    aplicarCombo(carrito, promo, idsAplicables, idsBeneficiados, aplicadas);
  }
}

/**
 * Aplica una promoción al carrito (regla: máximo una por pedido).
 *
 * @param {Array<{product_id:string, sku:string, cantidad:number, subtotal:number}>} carritoItems
 *   subtotal en pesos (número); el llamador convierte desde/hacia centavos.
 * @param {{promocionId?:string|null, codigo?:string|null}} [opts]
 *   promocionId: elegida por el cliente si hay varias; codigo: cupón capturado.
 *   Con cupón, el cupón gana sobre las automáticas.
 * @returns {Promise<{carrito, aplicadas, elegibles}>}
 *   - carrito: copia con subtotales ajustados y `promocion_id` en ítems afectados.
 *   - aplicadas: array (0 o 1) con la promoción aplicada.
 *   - elegibles: todas las promos que el cliente podría elegir.
 */
async function aplicarPromociones(carritoItems, { promocionId = null, codigo = null } = {}) {
  const carrito = JSON.parse(JSON.stringify(carritoItems));
  const elegibles = await promosElegibles(carrito, codigo);
  const aplicadas = [];

  if (!elegibles.length) return { carrito, aplicadas, elegibles: [] };

  let promoAAplicar = null;
  const cupon = codigo ? elegibles.find((p) => p.codigo === String(codigo).toUpperCase()) : null;
  if (cupon) {
    promoAAplicar = cupon;
  } else if (promocionId != null) {
    promoAAplicar = elegibles.find((p) => p.id === String(promocionId)) || null;
  } else if (elegibles.length === 1) {
    promoAAplicar = elegibles[0];
  }

  if (promoAAplicar) {
    const idsAplicables = idsDe(promoAAplicar.productos_aplicables);
    aplicarUna(carrito, promoAAplicar, idsAplicables, aplicadas);
  }

  return { carrito, aplicadas, elegibles };
}

module.exports = {
  aplicarPromociones,
  promosElegibles,
  aplicaHoy,
  promoEsElegible,
  TD_PORCENTAJE, TD_MONTO_FIJO, TD_2X1, TD_COMBO, TD_LLEVA_X,
};
