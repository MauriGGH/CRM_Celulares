/**
 * Checkout, pedidos del cliente y administración de pedidos.
 *   POST  /checkout                         cliente, Idempotency-Key
 *   GET   /orders                           cliente
 *   GET   /orders/:id
 *   POST  /orders/:id/cancel
 *   POST  /orders/:id/returns
 *   GET   /admin/orders                     gerente, almacén
 *   GET   /admin/orders/:id
 *   PATCH /admin/orders/:id/status
 *   POST  /admin/orders/:id/shipment
 *   POST  /admin/orders/:id/serials         asigna IMEI escaneados
 *   GET   /admin/returns
 *   PATCH /admin/returns/:id
 */
const express = require('express');
const auth = require('../../middleware/auth');
const { requireCliente, requireAlmacen } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const idempotency = require('../../middleware/idempotency');
const ah = require('../../utils/asyncHandler');
const serialize = require('../../utils/serialize');
const { parsePagination, paginated } = require('../../utils/pagination');
const { body, query, objectIdParam, pageQuery } = require('../../utils/validators');
const { ESTADOS_PEDIDO, TIPOS_DEVOLUCION, ESTADOS_DEVOLUCION } = require('../../utils/constants');
const svc = require('./order.service');

const client = express.Router();
client.use(['/checkout', '/orders'], auth, requireCliente);

client.post('/checkout', idempotency(), validate([
  body('address_id').isMongoId().withMessage('address_id requerido'),
  body('notas').optional().isString().isLength({ max: 500 }),
]), ah(async (req, res) => {
  const order = await svc.checkout(req.user, { address_id: req.body.address_id, notas: req.body.notas });
  res.status(201).json(serialize(order));
}));

client.get('/orders', validate(pageQuery), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.listMine(req.user.id, page);
  res.json(paginated(serialize(data), page, total));
}));

client.get('/orders/:id', validate([objectIdParam()]), ah(async (req, res) => {
  res.json(serialize(await svc.getMine(req.user, req.params.id)));
}));

client.post('/orders/:id/cancel', validate([objectIdParam(), body('motivo').optional().isString().isLength({ max: 300 })]), ah(async (req, res) => {
  res.json(serialize(await svc.cancelByCustomer(req.user, req.params.id, req.body.motivo)));
}));

client.post('/orders/:id/returns', validate([
  objectIdParam(),
  body('order_item_id').isMongoId(),
  body('motivo').isString().trim().isLength({ min: 3, max: 1000 }),
  body('tipo').isIn(TIPOS_DEVOLUCION),
  body('cantidad').optional().isInt({ min: 1, max: 10 }),
  body('imei').optional().matches(/^\d{15}$/),
]), ah(async (req, res) => {
  const { order_item_id, motivo, tipo, cantidad, imei } = req.body;
  const ret = await svc.requestReturn(req.user, req.params.id, { order_item_id, motivo, tipo, cantidad: cantidad ? Number(cantidad) : 1, imei });
  res.status(201).json(serialize(ret));
}));

const admin = express.Router();
admin.use(['/orders', '/returns'], auth, requireAlmacen);

admin.get('/orders', validate([
  ...pageQuery,
  query('estado').optional().isIn(ESTADOS_PEDIDO),
  query('desde').optional().isISO8601(),
  query('hasta').optional().isISO8601(),
  query('user_id').optional().isMongoId(),
]), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.listAdmin(req.query, page);
  res.json(paginated(serialize(data), page, total));
}));

admin.get('/orders/:id', validate([objectIdParam()]), ah(async (req, res) => {
  res.json(serialize(await svc.getAdmin(req.params.id)));
}));

admin.patch('/orders/:id/status', validate([
  objectIdParam(),
  body('estado').isIn(ESTADOS_PEDIDO),
  body('nota').optional().isString().isLength({ max: 500 }),
]), ah(async (req, res) => {
  res.json(serialize(await svc.changeStatus(req.user, req.params.id, req.body.estado, req.body.nota)));
}));

admin.post('/orders/:id/shipment', validate([
  objectIdParam(),
  body('paqueteria').isString().trim().isLength({ min: 2, max: 60 }),
  body('guia').isString().trim().isLength({ min: 4, max: 60 }),
]), ah(async (req, res) => {
  res.status(201).json(serialize(await svc.addShipment(req.user, req.params.id, { paqueteria: req.body.paqueteria, guia: req.body.guia })));
}));

admin.post('/orders/:id/serials', validate([
  objectIdParam(),
  body('asignaciones').isArray({ min: 1, max: 50 }),
  body('asignaciones.*.order_item_id').isMongoId(),
  body('asignaciones.*.imei').matches(/^\d{15}$/),
]), ah(async (req, res) => {
  const asignaciones = req.body.asignaciones.map(({ order_item_id, imei }) => ({ order_item_id, imei }));
  res.json(serialize(await svc.assignSerials(req.user, req.params.id, asignaciones)));
}));

admin.get('/returns', validate([
  ...pageQuery,
  query('estado').optional().isIn(ESTADOS_DEVOLUCION),
  query('tipo').optional().isIn(TIPOS_DEVOLUCION),
]), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.listReturns(req.query, page);
  res.json(paginated(serialize(data), page, total));
}));

admin.patch('/returns/:id', validate([
  objectIdParam(),
  body('estado').isIn(ESTADOS_DEVOLUCION),
  body('resolucion').optional().isString().isLength({ max: 1000 }),
  body('reintegrar_stock').optional().isBoolean(),
]), ah(async (req, res) => {
  const { estado, resolucion, reintegrar_stock } = req.body;
  res.json(serialize(await svc.updateReturn(req.user, req.params.id, { estado, resolucion, reintegrar_stock })));
}));

module.exports = { clientRouter: client, adminRouter: admin };
