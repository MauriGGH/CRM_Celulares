/**
 * Catálogo.
 * Público:  GET /products, GET /products/:slug, GET /brands, GET /categories
 * Gerente:  /admin/products (+ variantes e imágenes), /admin/brands,
 *           /admin/categories, POST /admin/uploads (jpg/png/webp ≤ 5 MB)
 */
const router = require('express').Router();
const multer = require('multer');
const auth = require('../../middleware/auth');
const { requireGerente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ah = require('../../utils/asyncHandler');
const serialize = require('../../utils/serialize');
const { parsePagination, paginated } = require('../../utils/pagination');
const { objectIdParam, pageQuery, query } = require('../../utils/validators');
const { saveImage, ALLOWED_TYPES } = require('../../utils/storage');
const { AppError, badRequest } = require('../../utils/errors');
const { ESTADOS_PRODUCTO } = require('../../utils/constants');
const svc = require('./catalog.service');
const v = require('./catalog.validators');

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const PRODUCT_FIELDS = ['brand_id', 'category_id', 'modelo', 'slug', 'descripcion', 'specs', 'condicion', 'garantia_meses', 'estado', 'variants'];
const VARIANT_FIELDS = ['sku', 'color', 'almacenamiento_gb', 'ram_gb', 'precio', 'precio_antes', 'costo', 'gtin', 'is_active', 'images'];

// ─── Público ──────────────────────────────────────────────────────────────
router.get('/products', validate([...pageQuery, ...v.listPublic]), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.listPublic(req.query, page);
  res.json(paginated(serialize(data), page, total));
}));

router.get('/products/:slug', ah(async (req, res) => {
  res.json(serialize(await svc.getPublicBySlug(req.params.slug)));
}));

router.get('/brands', ah(async (req, res) => res.json({ data: serialize(await svc.listBrands()) })));
router.get('/categories', ah(async (req, res) => res.json({ data: serialize(await svc.categoryTree()) })));

// ─── Admin: productos ─────────────────────────────────────────────────────
const admin = require('express').Router();
// Con alcance por ruta: el router se monta en /admin junto con otros módulos.
admin.use(['/products', '/brands', '/categories', '/uploads'], auth, requireGerente);

admin.get('/products', validate([
  ...pageQuery,
  query('estado').optional().isIn(ESTADOS_PRODUCTO),
  query('brand_id').optional().isMongoId(),
  query('category_id').optional().isMongoId(),
]), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.listAdmin(req.query, page);
  res.json(paginated(serialize(data), page, total));
}));

admin.get('/products/:id', validate([objectIdParam()]), ah(async (req, res) => {
  res.json(serialize(await svc.getById(req.params.id)));
}));

admin.post('/products', validate(v.createProduct), ah(async (req, res) => {
  const data = pick(req.body, PRODUCT_FIELDS);
  data.variants = (data.variants || []).map((x) => pick(x, VARIANT_FIELDS));
  res.status(201).json(serialize(await svc.createProduct(req.user, data)));
}));

admin.patch('/products/:id', validate(v.updateProduct), ah(async (req, res) => {
  const data = pick(req.body, PRODUCT_FIELDS.filter((k) => k !== 'variants'));
  res.json(serialize(await svc.updateProduct(req.user, req.params.id, data)));
}));

admin.delete('/products/:id', validate([objectIdParam()]), ah(async (req, res) => {
  // No se borra (hay pedidos que lo referencian): se archiva.
  res.json(serialize(await svc.updateProduct(req.user, req.params.id, { estado: 'archivado' })));
}));

admin.post('/products/:id/variants', validate(v.createVariant), ah(async (req, res) => {
  res.status(201).json(serialize(await svc.addVariant(req.user, req.params.id, pick(req.body, VARIANT_FIELDS))));
}));

admin.patch('/products/:id/variants/:variantId', validate(v.updateVariant), ah(async (req, res) => {
  res.json(serialize(await svc.updateVariant(req.user, req.params.id, req.params.variantId, pick(req.body, VARIANT_FIELDS))));
}));

admin.delete('/products/:id/variants/:variantId', validate([objectIdParam(), objectIdParam('variantId')]), ah(async (req, res) => {
  res.json(serialize(await svc.updateVariant(req.user, req.params.id, req.params.variantId, { is_active: false })));
}));

admin.post('/products/:id/images', validate(v.addImage), ah(async (req, res) => {
  res.status(201).json(serialize(await svc.addImage(req.params.id, pick(req.body, ['url', 'sku', 'orden']))));
}));

admin.delete('/products/:id/images', validate([objectIdParam(), query('url').isString().notEmpty()]), ah(async (req, res) => {
  res.json(serialize(await svc.removeImage(req.params.id, req.query.url)));
}));

// ─── Admin: marcas y categorías ───────────────────────────────────────────
admin.post('/brands', validate(v.brand(false)), ah(async (req, res) => {
  res.status(201).json(serialize(await svc.createBrand(pick(req.body, ['nombre', 'slug', 'logo_url']))));
}));
admin.patch('/brands/:id', validate([objectIdParam(), ...v.brand(true)]), ah(async (req, res) => {
  res.json(serialize(await svc.updateBrand(req.params.id, pick(req.body, ['nombre', 'slug', 'logo_url']))));
}));
admin.delete('/brands/:id', validate([objectIdParam()]), ah(async (req, res) => {
  await svc.deleteBrand(req.params.id);
  res.status(204).end();
}));
admin.post('/categories', validate(v.category(false)), ah(async (req, res) => {
  res.status(201).json(serialize(await svc.createCategory(pick(req.body, ['nombre', 'slug', 'parent_id']))));
}));
admin.patch('/categories/:id', validate([objectIdParam(), ...v.category(true)]), ah(async (req, res) => {
  res.json(serialize(await svc.updateCategory(req.params.id, pick(req.body, ['nombre', 'slug', 'parent_id']))));
}));
admin.delete('/categories/:id', validate([objectIdParam()]), ah(async (req, res) => {
  await svc.deleteCategory(req.params.id);
  res.status(204).end();
}));

// ─── Admin: subida de imágenes ────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_TYPES.includes(file.mimetype)),
});

admin.post('/uploads', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'ARCHIVO_DEMASIADO_GRANDE', 'Máximo 5 MB'));
    next(err);
  });
}, ah(async (req, res) => {
  if (!req.file) throw badRequest('Envía una imagen jpg, png o webp en el campo "file"');
  res.status(201).json(await saveImage(req.file));
}));

module.exports = { publicRouter: router, adminRouter: admin };
