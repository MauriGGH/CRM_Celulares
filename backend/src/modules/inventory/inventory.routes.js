/**
 * Inventario (almacén y gerente):
 *   GET   /admin/stock                 niveles con alerta de stock bajo
 *   GET   /admin/stock/movements       bitácora
 *   POST  /admin/stock/movements       entrada, ajuste o traspaso
 *   POST  /admin/serials               alta de IMEI en lote
 *   GET   /admin/serials/:imei         unidad con historial
 *   GET   /admin/warehouses            almacenes
 *   POST  /admin/warehouses            (gerente)
 *   PATCH /admin/warehouses/:id        (gerente)
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requireAlmacen, requireGerente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ah = require('../../utils/asyncHandler');
const serialize = require('../../utils/serialize');
const { parsePagination, paginated } = require('../../utils/pagination');
const { body, query, param, objectIdParam, pageQuery } = require('../../utils/validators');
const { TIPOS_ALMACEN } = require('../../utils/constants');
const svc = require('./inventory.service');

router.use(['/stock', '/serials', '/warehouses'], auth);

router.get('/stock', requireAlmacen, validate([
  ...pageQuery,
  query('warehouse_id').optional().isMongoId(),
  query('bajo').optional().isIn(['true', 'false']),
]), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total, umbral } = await svc.listStock(req.query, page);
  res.json({ ...paginated(serialize(data), page, total), umbral_stock_bajo: umbral });
}));

router.get('/stock/movements', requireAlmacen, validate([
  ...pageQuery,
  query('warehouse_id').optional().isMongoId(),
  query('tipo').optional().isIn(['entrada', 'venta', 'ajuste', 'devolucion', 'traspaso']),
]), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.listMovements(req.query, page);
  res.json(paginated(serialize(data), page, total));
}));

router.post('/stock/movements', requireAlmacen, validate([
  body('tipo').isIn(['entrada', 'ajuste', 'traspaso']).withMessage('tipo: entrada, ajuste o traspaso'),
  body('sku').isString().notEmpty(),
  body('warehouse_id').isMongoId(),
  body('warehouse_destino_id').if(body('tipo').equals('traspaso')).isMongoId().withMessage('requerido en traspaso'),
  body('cantidad').isInt({ min: -100000, max: 100000 }).custom((v) => Number(v) !== 0).withMessage('cantidad distinta de 0'),
  body('referencia').optional().isString().isLength({ max: 200 }),
]), ah(async (req, res) => {
  const { tipo, sku, warehouse_id, warehouse_destino_id, cantidad, referencia } = req.body;
  const movs = await svc.createMovement(req.user, { tipo, sku, warehouse_id, warehouse_destino_id, cantidad: Number(cantidad), referencia });
  res.status(201).json({ data: serialize(movs) });
}));

router.post('/serials', requireAlmacen, validate([
  body('sku').isString().notEmpty(),
  body('warehouse_id').isMongoId(),
  body('imeis').isArray({ min: 1, max: 500 }).withMessage('imeis: arreglo de 1 a 500'),
  body('referencia').optional().isString().isLength({ max: 200 }),
]), ah(async (req, res) => {
  const { sku, warehouse_id, imeis, referencia } = req.body;
  const created = await svc.registerSerials(req.user, { sku, warehouse_id, imeis, referencia });
  res.status(201).json({ creados: created.length, data: serialize(created) });
}));

router.get('/serials/:imei', requireAlmacen, validate([param('imei').matches(/^\d{15}$/).withMessage('IMEI de 15 dígitos')]), ah(async (req, res) => {
  res.json(serialize(await svc.getSerial(req.params.imei)));
}));

router.get('/warehouses', requireAlmacen, ah(async (req, res) => res.json({ data: serialize(await svc.listWarehouses()) })));

router.post('/warehouses', requireGerente, validate([
  body('nombre').isString().trim().isLength({ min: 1, max: 80 }),
  body('tipo').isIn(TIPOS_ALMACEN),
  body('direccion').optional().isString().isLength({ max: 300 }),
]), ah(async (req, res) => {
  const { nombre, tipo, direccion } = req.body;
  res.status(201).json(serialize(await svc.createWarehouse({ nombre, tipo, direccion })));
}));

router.patch('/warehouses/:id', requireGerente, validate([
  objectIdParam(),
  body('nombre').optional().isString().trim().isLength({ min: 1, max: 80 }),
  body('tipo').optional().isIn(TIPOS_ALMACEN),
  body('direccion').optional().isString().isLength({ max: 300 }),
  body('is_active').optional().isBoolean(),
]), ah(async (req, res) => {
  const { nombre, tipo, direccion, is_active } = req.body;
  const data = Object.fromEntries(Object.entries({ nombre, tipo, direccion, is_active }).filter(([, x]) => x !== undefined));
  res.json(serialize(await svc.updateWarehouse(req.params.id, data)));
}));

module.exports = router;
