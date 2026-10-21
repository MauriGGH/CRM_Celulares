/**
 * Carrito del cliente:
 *   GET    /cart
 *   POST   /cart/items          { sku, cantidad }  suma a lo que ya hay
 *   PATCH  /cart/items/:sku     { cantidad }
 *   DELETE /cart/items/:sku
 *   POST   /cart/coupon         { codigo }
 *   DELETE /cart/coupon
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requireCliente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ah = require('../../utils/asyncHandler');
const { body, param } = require('../../utils/validators');
const svc = require('./cart.service');

const skuParam = param('sku').matches(/^[A-Za-z0-9-_]{3,60}$/).withMessage('sku inválido');

router.use(auth, requireCliente);

router.get('/', ah(async (req, res) => res.json(await svc.view(req.user.id))));

router.post('/items', validate([
  body('sku').matches(/^[A-Za-z0-9-_]{3,60}$/).withMessage('sku inválido'),
  body('cantidad').optional().isInt({ min: 1, max: 10 }).withMessage('cantidad entre 1 y 10'),
]), ah(async (req, res) => {
  res.status(201).json(await svc.setQuantity(req.user.id, req.body.sku, Number(req.body.cantidad || 1), { sumar: true }));
}));

router.patch('/items/:sku', validate([skuParam, body('cantidad').isInt({ min: 1, max: 10 })]), ah(async (req, res) => {
  res.json(await svc.updateItem(req.user.id, req.params.sku, Number(req.body.cantidad)));
}));

router.delete('/items/:sku', validate([skuParam]), ah(async (req, res) => {
  res.json(await svc.removeItem(req.user.id, req.params.sku));
}));

router.post('/coupon', validate([body('codigo').isString().trim().isLength({ min: 3, max: 30 })]), ah(async (req, res) => {
  res.json(await svc.applyCoupon(req.user.id, req.body.codigo));
}));

router.delete('/coupon', ah(async (req, res) => res.json(await svc.removeCoupon(req.user.id))));

module.exports = router;
