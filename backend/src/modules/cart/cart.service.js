/**
 * Carrito persistente del cliente. Los precios se leen siempre del
 * catálogo (nunca del carrito) y el cupón se valida en cada lectura.
 */
const Cart = require('./cart.model');
const catalog = require('../catalog/catalog.service');
const inventory = require('../inventory/inventory.service');
const promotions = require('../promotions/promotion.service');
const { toCents } = require('../../utils/money');
const { notFound, conflict, unprocessable } = require('../../utils/errors');

const MAX_POR_SKU = 10;

async function getOrCreate(userId, session) {
  let cart = await Cart.findOne({ user_id: userId }).session(session || null);
  if (!cart) [cart] = await Cart.create([{ user_id: userId, items: [] }], session ? { session } : {});
  return cart;
}

/** Variante vendible: producto publicado y variante activa. */
async function sellable(sku) {
  const found = await catalog.findBySku(sku);
  if (!found || found.product.estado !== 'publicado' || !found.variant.is_active) {
    throw notFound('Producto');
  }
  return found;
}

/**
 * Arma las líneas con precio actual y calcula promociones.
 * @returns {Promise<{cart, lines, pricing, invalidas:string[]}>}
 */
async function build(cart) {
  const info = await catalog.findManyBySku(cart.items.map((i) => i.sku));
  const stock = await inventory.availabilityBySku(cart.items.map((i) => i.sku));
  const lines = [];
  const invalidas = [];
  for (const it of cart.items) {
    const f = info.get(it.sku);
    if (!f || f.product.estado !== 'publicado' || !f.variant.is_active) { invalidas.push(it.sku); continue; }
    lines.push({
      sku: it.sku,
      product_id: f.product._id,
      cantidad: it.cantidad,
      precio_cents: toCents(f.variant.precio.toString()),
      costo_cents: f.variant.costo ? toCents(f.variant.costo.toString()) : 0,
      descripcion: catalog.variantLabel(f.product, f.variant),
      slug: f.product.slug,
      imagen: f.variant.images?.[0] || f.product.images?.[0] || null,
      disponible: stock.get(it.sku) || 0,
    });
  }
  const codigo = cart.coupon_code || null;
  const pricing = await promotions.priceLines(lines, { codigo });
  return { cart, lines, pricing, invalidas, codigo };
}

/** Respuesta del carrito para la API. */
function present({ pricing, invalidas, codigo }) {
  const { fromCents } = require('../../utils/money');
  return {
    items: pricing.items.map((l) => ({
      sku: l.sku,
      product_id: String(l.product_id),
      descripcion: l.descripcion,
      slug: l.slug,
      imagen: l.imagen,
      cantidad: l.cantidad,
      precio_unitario: fromCents(l.precio_cents),
      subtotal: fromCents(l.subtotal_cents),
      descuento: fromCents(l.descuento_cents),
      disponible: l.disponible,
      stock_suficiente: l.disponible >= l.cantidad,
    })),
    cupon: codigo,
    promocion: pricing.promocion,
    promociones_elegibles: pricing.promociones_elegibles,
    subtotal: fromCents(pricing.subtotal_cents),
    descuento: fromCents(pricing.descuento_cents),
    envio: fromCents(pricing.envio_cents),
    total: fromCents(pricing.total_cents),
    skus_no_disponibles: invalidas,
  };
}

async function view(userId) {
  return present(await build(await getOrCreate(userId)));
}

async function setQuantity(userId, sku, cantidad, { sumar = false } = {}) {
  const { variant } = await sellable(sku);
  const cart = await getOrCreate(userId);
  const item = cart.items.find((i) => i.sku === variant.sku);
  const nueva = sumar && item ? item.cantidad + cantidad : cantidad;
  if (nueva > MAX_POR_SKU) throw conflict('LIMITE_POR_PRODUCTO', `Máximo ${MAX_POR_SKU} piezas por producto`);
  const disponible = (await inventory.availabilityBySku([variant.sku])).get(variant.sku) || 0;
  if (nueva > disponible) throw conflict('STOCK_INSUFICIENTE', `Solo hay ${disponible} disponibles`, { sku: variant.sku, disponible });
  if (item) item.cantidad = nueva;
  else {
    const { product } = await catalog.findBySku(variant.sku);
    cart.items.push({ sku: variant.sku, product_id: product._id, cantidad: nueva });
  }
  await cart.save();
  return view(userId);
}

async function updateItem(userId, sku, cantidad) {
  const cart = await getOrCreate(userId);
  if (!cart.items.some((i) => i.sku === String(sku).toUpperCase())) throw notFound('Artículo del carrito');
  return setQuantity(userId, sku, cantidad);
}

async function removeItem(userId, sku) {
  const cart = await getOrCreate(userId);
  const before = cart.items.length;
  cart.items = cart.items.filter((i) => i.sku !== String(sku).toUpperCase());
  if (cart.items.length === before) throw notFound('Artículo del carrito');
  await cart.save();
  return view(userId);
}

async function applyCoupon(userId, codigo) {
  const promo = await promotions.findCoupon(codigo);
  const cart = await getOrCreate(userId);
  const prev = cart.coupon_code;
  cart.coupon_code = promo.codigo;
  const built = await build(cart);
  if (!built.pricing.promocion || built.pricing.promocion.id !== String(promo._id)) {
    cart.coupon_code = prev;
    throw unprocessable('CUPON_NO_APLICA', 'El cupón no aplica a los productos del carrito');
  }
  await cart.save();
  return present(built);
}

async function removeCoupon(userId) {
  const cart = await getOrCreate(userId);
  cart.coupon_code = null;
  await cart.save();
  return view(userId);
}

async function clear(userId, session) {
  await Cart.updateOne({ user_id: userId }, { items: [], coupon_code: null }, { session });
}

module.exports = { getOrCreate, build, view, setQuantity, updateItem, removeItem, applyCoupon, removeCoupon, clear };
