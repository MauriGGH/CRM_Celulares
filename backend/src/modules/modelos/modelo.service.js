/**
 * Catálogo de fichas técnicas (`modelos`): búsqueda y alta de productos en
 * borrador a partir de una ficha. Nunca publica ni fija precios de venta.
 */
const { Types } = require('mongoose');
const Modelo = require('./modelo.model');
const catalog = require('../catalog/catalog.service');
const { escapeRegex } = require('../users/user.service');
const { notFound } = require('../../utils/errors');

/** "128GB / 256GB / 1TB" → [128, 256, 1024] */
function parseCapacidades(texto) {
  return [...String(texto || '').matchAll(/(\d+(?:\.\d+)?)\s*(TB|GB)/gi)]
    .map(([, n, u]) => Math.round(Number(n) * (u.toUpperCase() === 'TB' ? 1024 : 1)))
    .filter((n, i, a) => n > 0 && a.indexOf(n) === i);
}

/** "$899 USD" → { monto: "899.00", moneda: "USD" } */
function parsePrecio(texto) {
  const m = String(texto || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([A-Z]{3})?/);
  return m ? { monto: Number(m[1]).toFixed(2), moneda: m[2] || null } : null;
}

const num = (texto, re) => {
  const m = String(texto || '').match(re);
  return m ? Number(m[1]) : null;
};

/** Ficha normalizada como la ve el frontend y como se copia a `product.specs`. */
function normalize(doc) {
  return {
    id: String(doc._id),
    ref: doc.id ?? null,
    marca: doc.marca,
    modelo: doc.modelo,
    almacenamiento_gb: parseCapacidades(doc.almacenamiento),
    ram_gb: parseCapacidades(doc.memoria_ram),
    precio_referencia: parsePrecio(doc.precio),
    imagen: doc.imagen || null,
    url_fuente: doc.url_gsmarena || null,
    specs: {
      procesador: doc.procesador || null,
      pantalla: doc.pantalla || null,
      pantalla_pulgadas: num(doc.pantalla, /(\d+(?:\.\d+)?)\s*inch/i),
      medidas: doc.medidas || null,
      peso_g: num(doc.medidas, /\((\d+(?:\.\d+)?)\s*g\b/i),
      bateria: doc.bateria || null,
      bateria_mah: num(doc.bateria, /(\d{3,5})\s*mAh/i),
      camara_principal: doc.camara_principal || null,
      sistema_operativo: doc.sistema_operativo || null,
    },
  };
}

/** `:id` acepta el ObjectId o el `id` numérico del equipo de datos. */
function byId(id) {
  if (Types.ObjectId.isValid(id) && String(id).length === 24) return { _id: id };
  if (/^\d+$/.test(String(id))) return { id: Number(id) };
  return null;
}

async function list({ q, marca }, { skip, limit }) {
  const filter = {};
  if (marca) filter.marca = new RegExp(`^${escapeRegex(marca)}$`, 'i');
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ modelo: re }, { marca: re }];
  }
  const [data, total] = await Promise.all([
    Modelo.find(filter).sort({ marca: 1, modelo: 1 }).skip(skip).limit(limit).lean(),
    Modelo.countDocuments(filter),
  ]);
  return { data: data.map(normalize), total };
}

async function get(id) {
  const filter = byId(id);
  const doc = filter && await Modelo.findOne(filter).lean();
  if (!doc) throw notFound('Modelo');
  return normalize(doc);
}

/**
 * Crea (o amplía) un producto en borrador con la ficha.
 * @param {{category_id?:string, variantes:Array<{color:string, almacenamiento_gb:number, precio:string, sku?:string}>}} opts
 */
async function importAsDraft(actor, id, { category_id, variantes }) {
  const ficha = await get(id);
  return catalog.createDraftFromModelo(actor, ficha, { category_id, variantes });
}

module.exports = { list, get, importAsDraft, normalize, parseCapacidades, parsePrecio };
