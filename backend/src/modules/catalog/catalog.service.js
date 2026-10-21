/**
 * Catálogo: marcas, categorías, productos y variantes (SKU).
 */
const { Types } = require('mongoose');
const Product = require('./product.model');
const Brand = require('./brand.model');
const Category = require('./category.model');
const inventory = require('../inventory/inventory.service');
const slugify = require('../../utils/slug');
const { toCents, toDecimal, formatMoney } = require('../../utils/money');
const { notFound, conflict, badRequest } = require('../../utils/errors');
const { logAccion } = require('../../utils/auditoria');
const { escapeRegex } = require('../users/user.service');

// ─── Normalización y llaves de empate ──────────────────────────────────────

const norm = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * "Samsung", "Samsung Galaxy S25", 256, "Negro" → "samsung|galaxy s25|256|negro".
 * El modelo se guarda sin la marca al inicio para empatar ambas formas.
 */
function matchKey(brand, modelo, almacenamientoGb, color) {
  const b = norm(brand);
  let m = norm(modelo);
  if (b && m.startsWith(`${b} `)) m = m.slice(b.length + 1);
  return [b, m, almacenamientoGb ?? '', norm(color)].join('|');
}

/** Llena match_key de cada variante con la marca y el modelo del producto. */
function refreshMatchKeys(product) {
  for (const v of product.variants) {
    v.match_key = matchKey(product.brand_nombre, product.modelo, v.almacenamiento_gb, v.color);
  }
}

// ─── Lecturas públicas ────────────────────────────────────────────────────

async function categoryWithDescendants(slug) {
  const root = await Category.findOne({ slug }).lean();
  if (!root) return [];
  const all = await Category.find().select('_id parent_id').lean();
  const ids = [root._id];
  for (let i = 0; i < ids.length; i++) {
    for (const c of all) if (c.parent_id && String(c.parent_id) === String(ids[i])) ids.push(c._id);
  }
  return ids;
}

const SORTS = {
  relevancia: { created_at: -1 },
  nuevos: { created_at: -1 },
  precio_asc: { precio_desde: 1, _id: 1 },
  precio_desc: { precio_desde: -1, _id: 1 },
  nombre: { modelo: 1, _id: 1 },
};

/**
 * Lista pública con filtros y paginación. Solo productos `publicado` con
 * al menos una variante activa que cumpla los filtros de precio y almacenamiento.
 */
async function listPublic(q, { skip, limit }) {
  const match = { estado: 'publicado' };
  if (q.brand) {
    const brand = await Brand.findOne({ slug: q.brand }).lean();
    if (!brand) return { data: [], total: 0 };
    match.brand_id = brand._id;
  }
  if (q.category) {
    const ids = await categoryWithDescendants(q.category);
    if (!ids.length) return { data: [], total: 0 };
    match.category_id = { $in: ids };
  }
  if (q.condition) match.condicion = q.condition;
  if (q.q) {
    match.$and = String(q.q).trim().split(/\s+/).slice(0, 8).map((term) => {
      const re = new RegExp(escapeRegex(term), 'i');
      return { $or: [{ modelo: re }, { brand_nombre: re }] };
    });
  }

  const variantCond = [{ $eq: ['$$v.is_active', true] }];
  const elem = { is_active: true };
  if (q.min_price) {
    elem.precio = { ...elem.precio, $gte: toDecimal(toCents(q.min_price)) };
    variantCond.push({ $gte: ['$$v.precio', toDecimal(toCents(q.min_price))] });
  }
  if (q.max_price) {
    elem.precio = { ...elem.precio, $lte: toDecimal(toCents(q.max_price)) };
    variantCond.push({ $lte: ['$$v.precio', toDecimal(toCents(q.max_price))] });
  }
  if (q.storage_gb) {
    elem.almacenamiento_gb = Number(q.storage_gb);
    variantCond.push({ $eq: ['$$v.almacenamiento_gb', Number(q.storage_gb)] });
  }
  match.variants = { $elemMatch: elem };

  const [res] = await Product.aggregate([
    { $match: match },
    { $addFields: { variantes_ok: { $filter: { input: '$variants', as: 'v', cond: { $and: variantCond } } } } },
    { $addFields: { precio_desde: { $min: '$variantes_ok.precio' } } },
    { $sort: SORTS[q.sort] || SORTS.relevancia },
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        total: [{ $count: 'n' }],
      },
    },
  ]);
  const products = res.data;
  const stock = await inventory.availabilityByProduct(products.map((p) => p._id));
  const data = products.map((p) => ({
    _id: p._id,
    slug: p.slug,
    modelo: p.modelo,
    marca: p.brand_nombre,
    condicion: p.condicion,
    precio_desde: p.precio_desde,
    precio_antes: maxPrecioAntes(p.variantes_ok),
    almacenamientos_gb: [...new Set(p.variantes_ok.map((v) => v.almacenamiento_gb))].sort((a, b) => a - b),
    colores: [...new Set(p.variantes_ok.map((v) => v.color))],
    imagen: p.images?.[0] || p.variantes_ok.find((x) => x.images?.length)?.images[0] || null,
    disponible: (stock.get(String(p._id)) || 0) > 0,
  }));
  return { data, total: res.total[0]?.n || 0 };
}

function maxPrecioAntes(variants) {
  const vals = variants.map((v) => v.precio_antes).filter(Boolean).map((d) => toCents(d.toString()));
  return vals.length ? toDecimal(Math.max(...vals)) : null;
}

/** Ficha pública por slug, con disponibilidad por variante. */
async function getPublicBySlug(slug) {
  const p = await Product.findOne({ slug, estado: 'publicado' })
    .populate('brand_id', 'nombre slug logo_url')
    .populate('category_id', 'nombre slug')
    .lean();
  if (!p) throw notFound('Producto');
  const variants = p.variants.filter((v) => v.is_active);
  const stock = await inventory.availabilityBySku(variants.map((v) => v.sku));
  return {
    _id: p._id,
    slug: p.slug,
    modelo: p.modelo,
    marca: p.brand_id,
    categoria: p.category_id,
    descripcion: p.descripcion,
    specs: p.specs,
    condicion: p.condicion,
    garantia_meses: p.garantia_meses,
    images: p.images || [],
    variants: variants.map((v) => ({
      sku: v.sku,
      color: v.color,
      almacenamiento_gb: v.almacenamiento_gb,
      ram_gb: v.ram_gb,
      precio: v.precio,
      precio_antes: v.precio_antes ?? null,
      images: v.images || [],
      disponible: (stock.get(v.sku) || 0) > 0,
    })),
  };
}

const listBrands = () => Brand.find().sort({ nombre: 1 }).lean();

async function categoryTree() {
  const all = await Category.find().sort({ nombre: 1 }).lean();
  const byParent = new Map();
  for (const c of all) {
    const k = c.parent_id ? String(c.parent_id) : 'root';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  }
  const build = (k) => (byParent.get(k) || []).map((c) => ({ ...c, children: build(String(c._id)) }));
  return build('root');
}

// ─── Variantes (las usan carrito, inventario, pedidos e ingesta) ──────────

/**
 * @param {string} sku
 * @returns {Promise<{product:object, variant:object}|null>}
 */
async function findBySku(sku) {
  const product = await Product.findOne({ 'variants.sku': String(sku).toUpperCase() }).lean();
  if (!product) return null;
  const variant = product.variants.find((v) => v.sku === String(sku).toUpperCase());
  return { product, variant };
}

/** @param {string[]} skus @returns {Promise<Map<string,{product, variant}>>} */
async function findManyBySku(skus) {
  const upper = skus.map((s) => String(s).toUpperCase());
  const products = await Product.find({ 'variants.sku': { $in: upper } }).lean();
  const out = new Map();
  for (const product of products) {
    for (const variant of product.variants) if (upper.includes(variant.sku)) out.set(variant.sku, { product, variant });
  }
  return out;
}

const findByGtin = (gtin) => Product.findOne({ 'variants.gtin': gtin }).lean();
const findByMatchKey = (key) => Product.findOne({ 'variants.match_key': key }).lean();
const findByBrandName = (brandNombre) => Product.find({ brand_nombre: new RegExp(`^${escapeRegex(brandNombre)}$`, 'i') }).lean();

/** "Galaxy S25 Ultra 256GB Negro". */
function variantLabel(product, variant) {
  return `${product.brand_nombre} ${product.modelo} ${variant.almacenamiento_gb}GB ${variant.color}`;
}

// ─── Admin ────────────────────────────────────────────────────────────────

const MONEY_FIELDS = ['precio', 'precio_antes', 'costo'];

function variantInput(v) {
  const out = {};
  for (const k of ['sku', 'color', 'almacenamiento_gb', 'ram_gb', 'gtin', 'is_active', 'images']) if (v[k] !== undefined) out[k] = v[k];
  for (const k of MONEY_FIELDS) {
    if (v[k] !== undefined) out[k] = v[k] === null ? null : toDecimal(toCents(v[k]));
  }
  if (out.gtin === '') out.gtin = undefined;
  return out;
}

async function uniqueSlug(base, excludeId) {
  let slug = slugify(base) || 'producto';
  for (let i = 2; await Product.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }); i++) {
    slug = `${slugify(base)}-${i}`;
  }
  return slug;
}

async function assertSkusFree(skus, excludeProductId) {
  const dup = skus.find((s, i) => skus.indexOf(s) !== i);
  if (dup) throw conflict('SKU_DUPLICADO', `SKU repetido: ${dup}`);
  const taken = await Product.findOne({
    'variants.sku': { $in: skus },
    ...(excludeProductId ? { _id: { $ne: excludeProductId } } : {}),
  }).lean();
  if (taken) throw conflict('SKU_DUPLICADO', 'Algún SKU ya existe en otro producto');
}

async function listAdmin(q, { skip, limit }) {
  const filter = {};
  if (q.estado) filter.estado = q.estado;
  if (q.brand_id) filter.brand_id = q.brand_id;
  if (q.category_id) filter.category_id = q.category_id;
  if (q.q) {
    const re = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ modelo: re }, { brand_nombre: re }, { 'variants.sku': re }];
  }
  const [data, total] = await Promise.all([
    Product.find(filter).sort({ updated_at: -1 }).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  return { data, total };
}

async function getById(id) {
  const p = await Product.findById(id);
  if (!p) throw notFound('Producto');
  return p;
}

async function createProduct(actor, data) {
  const brand = await Brand.findById(data.brand_id);
  if (!brand) throw badRequest('Marca inexistente', { brand_id: 'no existe' });
  if (!(await Category.exists({ _id: data.category_id }))) throw badRequest('Categoría inexistente', { category_id: 'no existe' });
  const variants = (data.variants || []).map(variantInput);
  await assertSkusFree(variants.map((v) => String(v.sku).toUpperCase()));
  const product = new Product({
    brand_id: brand._id,
    brand_nombre: brand.nombre,
    category_id: data.category_id,
    modelo: data.modelo,
    slug: await uniqueSlug(data.slug || `${brand.nombre} ${data.modelo}`),
    descripcion: data.descripcion,
    specs: data.specs || {},
    condicion: data.condicion,
    garantia_meses: data.garantia_meses,
    estado: data.estado || 'borrador',
    variants,
    images: data.images || [],
  });
  refreshMatchKeys(product);
  await product.save();
  await logAccion(actor.id, 'producto.crear', { modelo: product.modelo }, { entidad: 'product', entidadId: product.id });
  return product;
}

async function updateProduct(actor, id, data) {
  const product = await getById(id);
  if (data.brand_id && String(data.brand_id) !== String(product.brand_id)) {
    const brand = await Brand.findById(data.brand_id);
    if (!brand) throw badRequest('Marca inexistente', { brand_id: 'no existe' });
    product.brand_id = brand._id;
    product.brand_nombre = brand.nombre;
  }
  if (data.category_id) {
    if (!(await Category.exists({ _id: data.category_id }))) throw badRequest('Categoría inexistente');
    product.category_id = data.category_id;
  }
  for (const k of ['modelo', 'descripcion', 'specs', 'condicion', 'garantia_meses', 'estado']) {
    if (data[k] !== undefined) product[k] = data[k];
  }
  if (data.slug) product.slug = await uniqueSlug(data.slug, product._id);
  if (product.estado === 'publicado' && !product.variants.some((v) => v.is_active)) {
    throw conflict('PRODUCTO_SIN_VARIANTES', 'No se puede publicar un producto sin variantes activas');
  }
  refreshMatchKeys(product);
  await product.save();
  await logAccion(actor.id, 'producto.editar', { campos: Object.keys(data) }, { entidad: 'product', entidadId: product.id });
  return product;
}

async function addVariant(actor, productId, data) {
  const product = await getById(productId);
  const v = variantInput(data);
  await assertSkusFree([String(v.sku).toUpperCase(), ...product.variants.map((x) => x.sku)]);
  product.variants.push(v);
  refreshMatchKeys(product);
  await product.save();
  const created = product.variants[product.variants.length - 1];
  await logAccion(actor.id, 'variante.crear', { sku: created.sku, precio: formatMoney(created.precio) }, { entidad: 'product', entidadId: product.id });
  return created;
}

/** Edita una variante. Cada cambio de precio o costo queda en audit_logs. */
async function updateVariant(actor, productId, variantId, data) {
  const product = await getById(productId);
  const variant = product.variants.id(variantId);
  if (!variant) throw notFound('Variante');
  const input = variantInput(data);
  if (input.sku && input.sku.toUpperCase() !== variant.sku) {
    await assertSkusFree([input.sku.toUpperCase()], product._id);
  }
  const cambios = {};
  for (const k of MONEY_FIELDS) {
    if (input[k] === undefined) continue;
    const antes = variant[k] ? formatMoney(variant[k]) : null;
    const despues = input[k] ? formatMoney(input[k]) : null;
    if (antes !== despues) cambios[k] = { antes, despues };
  }
  variant.set(input);
  refreshMatchKeys(product);
  await product.save();
  if (Object.keys(cambios).length) {
    await logAccion(actor.id, 'precio.cambio', { sku: variant.sku, ...cambios }, { entidad: 'product', entidadId: product.id });
  }
  return variant;
}

/** Agrega una URL a las fotos del producto o de una variante (por sku). */
async function addImage(productId, { url, sku, orden }) {
  const product = await getById(productId);
  let list = product.images;
  if (sku) {
    const v = product.variants.find((x) => x.sku === String(sku).toUpperCase());
    if (!v) throw badRequest('La variante no pertenece al producto');
    list = v.images;
  }
  if (!list.includes(url)) list.splice(orden ?? list.length, 0, url);
  await product.save();
  return product;
}

async function removeImage(productId, url) {
  const product = await getById(productId);
  let found = false;
  for (const list of [product.images, ...product.variants.map((v) => v.images)]) {
    const i = list.indexOf(url);
    if (i >= 0) { list.splice(i, 1); found = true; }
  }
  if (!found) throw notFound('Imagen');
  await product.save();
  return product;
}

/**
 * Crea un producto en borrador a partir de un registro de ingesta aprobado.
 * Nunca lo publica: el gerente revisa precio, costo e imágenes antes.
 */
async function createDraftFromIngest(actor, rec, { category_id, sku }) {
  const p = rec.payload;
  let brand = await Brand.findOne({ nombre: new RegExp(`^${escapeRegex(p.brand)}$`, 'i') });
  if (!brand) brand = await Brand.create({ nombre: p.brand, slug: await uniqueBrandSlug(p.brand) });
  const category = category_id
    ? await Category.findById(category_id)
    : await Category.findOne({ slug: 'celulares' });
  if (!category) throw badRequest('Indica category_id (no existe la categoría "celulares")');
  const baseSku = sku || slugify(`${brand.nombre}-${p.model}-${p.storage_gb || ''}-${p.color || ''}`).toUpperCase().slice(0, 60);
  let finalSku = baseSku;
  for (let i = 2; await Product.exists({ 'variants.sku': finalSku }); i++) finalSku = `${baseSku}-${i}`;

  // Si ya existe el producto (misma marca y modelo), se agrega la variante.
  let product = await Product.findOne({ brand_id: brand._id, modelo: new RegExp(`^${escapeRegex(p.model)}$`, 'i') });
  const variant = {
    sku: finalSku,
    color: p.color || 'Sin color',
    almacenamiento_gb: p.storage_gb || 0,
    ram_gb: p.ram_gb || undefined,
    precio: toDecimal(toCents(p.price)), // referencia; el gerente fija el precio real
    gtin: p.gtin || undefined,
    is_active: false,
  };
  if (product) {
    product.variants.push(variant);
  } else {
    product = new Product({
      brand_id: brand._id,
      brand_nombre: brand.nombre,
      category_id: category._id,
      modelo: p.model,
      slug: await uniqueSlug(`${brand.nombre} ${p.model}`),
      specs: p.specs || {},
      condicion: p.condition,
      estado: 'borrador',
      origen: 'ingesta',
      ingest_record_id: rec._id,
      variants: [variant],
      images: (p.images || []).slice(0, 10),
    });
  }
  refreshMatchKeys(product);
  await product.save();
  await logAccion(actor.id, 'producto.crear_desde_ingesta', { sku: finalSku, source: rec.source }, { entidad: 'product', entidadId: product.id });
  return { product, sku: finalSku };
}

/**
 * Producto en borrador desde una ficha de `modelos` (ver modules/modelos).
 * Si ya existe el producto (misma marca y modelo) se le agregan las variantes
 * que falten; las specs e imagen de la ficha solo llenan lo vacío.
 */
async function createDraftFromModelo(actor, ficha, { category_id, variantes }) {
  let brand = await Brand.findOne({ nombre: new RegExp(`^${escapeRegex(ficha.marca)}$`, 'i') });
  if (!brand) brand = await Brand.create({ nombre: ficha.marca, slug: await uniqueBrandSlug(ficha.marca) });
  const category = category_id
    ? await Category.findById(category_id)
    : await Category.findOne({ slug: 'celulares' });
  if (!category) throw badRequest('Indica category_id (no existe la categoría "celulares")');

  let product = await Product.findOne({ brand_id: brand._id, modelo: new RegExp(`^${escapeRegex(ficha.modelo)}$`, 'i') });
  if (!product) {
    product = new Product({
      brand_id: brand._id,
      brand_nombre: brand.nombre,
      category_id: category._id,
      modelo: ficha.modelo,
      slug: await uniqueSlug(`${brand.nombre} ${ficha.modelo}`),
      estado: 'borrador',
      origen: 'modelos',
      modelo_ref: String(ficha.ref ?? ficha.id),
      variants: [],
    });
  }
  const specs = { ...(product.specs || {}) };
  for (const [k, v] of Object.entries(ficha.specs)) if (v != null && specs[k] == null) specs[k] = v;
  if (ficha.url_fuente && !specs.url_fuente) specs.url_fuente = ficha.url_fuente;
  product.specs = specs;
  if (ficha.imagen && !product.images.includes(ficha.imagen)) product.images.push(ficha.imagen);

  const ram = ficha.ram_gb.length ? Math.max(...ficha.ram_gb) : undefined;
  const creados = [];
  for (const v of variantes) {
    const ya = product.variants.find((x) => x.almacenamiento_gb === v.almacenamiento_gb && norm(x.color) === norm(v.color));
    if (ya) continue;
    const base = (v.sku || slugify(`${brand.nombre}-${ficha.modelo}-${v.almacenamiento_gb}-${v.color}`)).toUpperCase().slice(0, 60);
    let sku = base;
    for (let i = 2; await Product.exists({ 'variants.sku': sku }) || product.variants.some((x) => x.sku === sku); i++) sku = `${base}-${i}`;
    product.variants.push({
      sku, color: v.color, almacenamiento_gb: v.almacenamiento_gb, ram_gb: ram,
      precio: toDecimal(toCents(v.precio)), is_active: true,
    });
    creados.push(sku);
  }
  if (!product.variants.length) throw badRequest('Indica al menos una variante');
  refreshMatchKeys(product);
  await product.save();
  await logAccion(actor.id, 'producto.crear_desde_modelo', { modelo: ficha.modelo, ref: ficha.ref, skus: creados }, { entidad: 'product', entidadId: product.id });
  return product;
}

async function uniqueBrandSlug(nombre) {
  let slug = slugify(nombre);
  for (let i = 2; await Brand.exists({ slug }); i++) slug = `${slugify(nombre)}-${i}`;
  return slug;
}

// Marcas y categorías
async function createBrand({ nombre, slug, logo_url }) {
  return Brand.create({ nombre, slug: slug || (await uniqueBrandSlug(nombre)), logo_url });
}
async function updateBrand(id, data) {
  const brand = await Brand.findById(id);
  if (!brand) throw notFound('Marca');
  brand.set(data);
  await brand.save();
  if (data.nombre) await Product.updateMany({ brand_id: brand._id }, { brand_nombre: brand.nombre });
  return brand;
}
async function deleteBrand(id) {
  if (await Product.exists({ brand_id: id })) throw conflict('MARCA_EN_USO', 'La marca tiene productos');
  const r = await Brand.deleteOne({ _id: id });
  if (!r.deletedCount) throw notFound('Marca');
}
async function createCategory({ nombre, slug, parent_id }) {
  if (parent_id && !(await Category.exists({ _id: parent_id }))) throw badRequest('Categoría padre inexistente');
  return Category.create({ nombre, slug: slug || slugify(nombre), parent_id: parent_id || null });
}
async function updateCategory(id, data) {
  const cat = await Category.findById(id);
  if (!cat) throw notFound('Categoría');
  if (data.parent_id && String(data.parent_id) === String(id)) throw badRequest('Una categoría no puede ser su propio padre');
  cat.set(data);
  await cat.save();
  return cat;
}
async function deleteCategory(id) {
  if (await Product.exists({ category_id: id })) throw conflict('CATEGORIA_EN_USO', 'La categoría tiene productos');
  if (await Category.exists({ parent_id: id })) throw conflict('CATEGORIA_EN_USO', 'La categoría tiene subcategorías');
  const r = await Category.deleteOne({ _id: id });
  if (!r.deletedCount) throw notFound('Categoría');
}

module.exports = {
  norm, matchKey, listPublic, getPublicBySlug, listBrands, categoryTree,
  findBySku, findManyBySku, findByGtin, findByMatchKey, findByBrandName, variantLabel,
  listAdmin, getById, createProduct, updateProduct, addVariant, updateVariant, addImage, removeImage,
  createDraftFromIngest, createDraftFromModelo, createBrand, updateBrand, deleteBrand, createCategory, updateCategory, deleteCategory,
  isObjectId: (id) => Types.ObjectId.isValid(id),
};
