/**
 * API para sistemas externos (B15), montada en /external/v1. Contrato:
 * docs/external-api.yaml. Solo lectura, autenticación con `X-API-Key`.
 *   GET  /me                                  cliente en uso y sus permisos
 *   GET  /products?updated_since=&marca=&cursor=&limit=     catalog:read
 *   GET  /products/:sku                                      catalog:read
 *   GET  /stock?updated_since=&sku=&cursor=&limit=           stock:read
 *   GET  /prices/history?sku=&source=&from=&to=&cursor=      prices:read
 *   GET  /reports/sales?group_by=day|brand|sku&from=&to=     sales:read
 *   POST /exports  { resource, format: json|csv|xlsx, filters }  → 202 { export_id }
 *   GET  /exports/:id                         estado y enlace firmado (24 h)
 *   GET  /exports/:id/download?expires=&sig=  descarga (sin API key)
 * Listas: JSON `{ data, meta: { limit, count, next_cursor } }` o CSV con
 * `?format=csv` / `Accept: text/csv` (el cursor va en `X-Next-Cursor`).
 *
 * Clientes (gerente, admin): /admin/api-clients
 *   GET, POST { nombre, scopes[], limite_por_minuto?, vence_en? } → la llave se ve una sola vez
 *   PATCH /:id { nombre?, scopes?, limite_por_minuto?, vence_en?, activo? }
 *   POST /:id/rotate → llave nueva (la anterior deja de servir)
 *   DELETE /:id → revoca (activo: false)
 */
const express = require('express');
const auth = require('../../middleware/auth');
const { requireGerente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ah = require('../../utils/asyncHandler');
const serialize = require('../../utils/serialize');
const { toCsv } = require('../../utils/csv');
const { logAccion } = require('../../utils/auditoria');
const { notFound } = require('../../utils/errors');
const { body, query, param, objectIdParam } = require('../../utils/validators');
const { SCOPES_EXTERNOS, RECURSOS_EXPORT, FORMATOS_EXPORT } = require('../../utils/constants');
const { apiKeyAuth, requireScope, generateKey, verifySignature } = require('./external.auth');
const ApiClient = require('./api-client.model');
const svc = require('./external.service');
const exportsSvc = require('./export.service');

const list = [
  query('format').optional().isIn(['json', 'csv']),
  query('limit').optional().isInt({ min: 1, max: 1000 }).toInt(),
  query('cursor').optional().isMongoId().withMessage('cursor: usa el next_cursor de la respuesta anterior'),
];
const date = (n) => query(n).optional().isISO8601().withMessage(`${n}: fecha ISO 8601`);

const wantsCsv = (req) => req.query.format === 'csv' || (!req.query.format && /text\/csv/.test(req.get('accept') || ''));
const params = (req) => ({ ...req.query, limit: req.query.limit || 100, cursor: req.query.cursor || null });

function csv(res, name, columns, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${name}.csv"`);
  res.send(toCsv(columns, rows));
}

/** Página en JSON `{ data, meta }` o CSV con el cursor en `X-Next-Cursor`. */
function send(req, res, name, columns, { data, next_cursor }) {
  if (next_cursor) res.set('X-Next-Cursor', next_cursor);
  if (wantsCsv(req)) return csv(res, name, columns, data);
  res.json({ data, meta: { limit: params(req).limit, count: data.length, next_cursor } });
}

const router = express.Router();

// La descarga va antes de la autenticación: la protege la firma del enlace.
router.get('/exports/:id/download', validate([objectIdParam(), query('expires').isInt(), query('sig').isHexadecimal()]), ah(async (req, res) => {
  if (!verifySignature(req.params.id, req.query.expires, req.query.sig)) throw notFound('Exportación');
  const f = await exportsSvc.openDownload(req.params.id);
  res.set({ 'Content-Type': f.contentType, 'Content-Disposition': `attachment; filename="${f.filename}"`, 'Cache-Control': 'no-store' });
  if (f.bytes != null) res.set('Content-Length', String(f.bytes));
  f.stream.on('error', (err) => res.destroy(err)).pipe(res);
}));

router.use(apiKeyAuth);

router.get('/me', (req, res) => res.json(req.apiClient));

router.get('/products', requireScope('catalog:read'), validate([...list, date('updated_since'), query('marca').optional().isString().isLength({ max: 50 })]), ah(async (req, res) => {
  send(req, res, 'productos', svc.PRODUCT_COLUMNS, await svc.products(params(req)));
}));

router.get('/products/:sku', requireScope('catalog:read'), validate([param('sku').isString().isLength({ min: 3, max: 60 })]), ah(async (req, res) => {
  res.json(await svc.productBySku(req.params.sku));
}));

router.get('/stock', requireScope('stock:read'), validate([...list, date('updated_since'), query('sku').optional().isString().isLength({ max: 60 })]), ah(async (req, res) => {
  send(req, res, 'stock', svc.STOCK_COLUMNS, await svc.stock(params(req)));
}));

router.get('/prices/history', requireScope('prices:read'), validate([
  ...list, date('from'), date('to'),
  query('sku').optional().isString().isLength({ max: 60 }),
  query('source').optional().isString().isLength({ max: 50 }),
]), ah(async (req, res) => {
  send(req, res, 'precios_competencia', svc.PRICE_COLUMNS, await svc.priceHistory(params(req)));
}));

router.get('/reports/sales', requireScope('sales:read'), validate([
  query('format').optional().isIn(['json', 'csv']),
  query('group_by').optional().isIn(['day', 'brand', 'sku']),
  date('from'), date('to'),
]), ah(async (req, res) => {
  const r = await svc.sales({ group_by: req.query.group_by || 'day', from: req.query.from, to: req.query.to });
  if (wantsCsv(req)) return csv(res, `ventas_por_${r.group_by}`, svc.SALES_COLUMNS[r.group_by], r.data);
  res.json(r);
}));

router.post('/exports', validate([
  body('resource').isIn(RECURSOS_EXPORT).withMessage(`resource: ${RECURSOS_EXPORT.join(', ')}`),
  body('format').isIn(FORMATOS_EXPORT).withMessage(`format: ${FORMATOS_EXPORT.join(', ')}`),
  body('filters').optional().isObject(),
  body('filters.updated_since').optional().isISO8601(),
  body('filters.from').optional().isISO8601(),
  body('filters.to').optional().isISO8601(),
  body('filters.group_by').optional().isIn(['day', 'brand', 'sku']),
]), ah(async (req, res) => {
  const allowed = ['updated_since', 'from', 'to', 'sku', 'source', 'marca', 'group_by'];
  const filters = Object.fromEntries(Object.entries(req.body.filters || {}).filter(([k, v]) => allowed.includes(k) && typeof v === 'string'));
  const job = await exportsSvc.create(req.apiClient, { resource: req.body.resource, format: req.body.format, filters });
  res.status(202).json({ export_id: job.id, status: job.status });
}));

router.get('/exports/:id', ah(async (req, res) => res.json(await exportsSvc.get(req.apiClient, req.params.id))));

// ─── Administración de clientes ───────────────────────────────────────────

const admin = express.Router();
admin.use('/api-clients', auth, requireGerente);

const strip = (doc) => { const { key_hash, ...rest } = doc.toObject ? doc.toObject() : doc; return serialize(rest); }; // eslint-disable-line no-unused-vars

const clientFields = (optional) => {
  const f = (name) => (optional ? body(name).optional() : body(name));
  return [
    f('nombre').isString().trim().isLength({ min: 2, max: 80 }),
    f('scopes').isArray({ min: 1 }).withMessage(`scopes: ${SCOPES_EXTERNOS.join(', ')}`),
    body('scopes.*').isIn(SCOPES_EXTERNOS),
    body('limite_por_minuto').optional().isInt({ min: 1, max: 1000 }).toInt(),
    body('vence_en').optional({ values: 'null' }).isISO8601(),
  ];
};

admin.get('/api-clients', ah(async (_req, res) => {
  res.json((await ApiClient.find().sort({ created_at: -1 }).lean()).map(strip));
}));

admin.post('/api-clients', validate(clientFields(false)), ah(async (req, res) => {
  const { raw, prefix, key_hash } = generateKey();
  const client = await ApiClient.create({
    nombre: req.body.nombre, scopes: [...new Set(req.body.scopes)], limite_por_minuto: req.body.limite_por_minuto,
    vence_en: req.body.vence_en || null, prefix, key_hash, creado_por: req.user.id,
  });
  await logAccion(req.user.id, 'api_client.crear', { nombre: client.nombre, scopes: client.scopes, prefix }, { entidad: 'api_client', entidadId: client.id });
  res.status(201).json({ ...strip(client), api_key: raw });
}));

admin.patch('/api-clients/:id', validate([objectIdParam(), ...clientFields(true), body('activo').optional().isBoolean()]), ah(async (req, res) => {
  const update = {};
  for (const k of ['nombre', 'limite_por_minuto', 'vence_en', 'activo']) if (req.body[k] !== undefined) update[k] = req.body[k];
  if (req.body.scopes) update.scopes = [...new Set(req.body.scopes)];
  const client = await ApiClient.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!client) throw notFound('Cliente de API');
  await logAccion(req.user.id, 'api_client.editar', update, { entidad: 'api_client', entidadId: client.id });
  res.json(strip(client));
}));

admin.post('/api-clients/:id/rotate', validate([objectIdParam()]), ah(async (req, res) => {
  const { raw, prefix, key_hash } = generateKey();
  const client = await ApiClient.findByIdAndUpdate(req.params.id, { prefix, key_hash }, { new: true });
  if (!client) throw notFound('Cliente de API');
  await logAccion(req.user.id, 'api_client.rotar', { nombre: client.nombre, prefix }, { entidad: 'api_client', entidadId: client.id });
  res.json({ ...strip(client), api_key: raw });
}));

admin.delete('/api-clients/:id', validate([objectIdParam()]), ah(async (req, res) => {
  const client = await ApiClient.findByIdAndUpdate(req.params.id, { activo: false }, { new: true });
  if (!client) throw notFound('Cliente de API');
  await logAccion(req.user.id, 'api_client.revocar', { nombre: client.nombre }, { entidad: 'api_client', entidadId: client.id });
  res.status(204).end();
}));

module.exports = { externalRouter: router, adminRouter: admin };
