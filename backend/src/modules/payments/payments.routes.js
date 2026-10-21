/**
 * Pagos:
 *   POST /payments/:provider/create   cliente  { order_id }            → { approve_url }
 *   POST /payments/:provider/capture  cliente  { order_id, referencia } (PayPal: id de la orden; MP: payment_id)
 *   POST /webhooks/:provider          público, firma verificada
 * provider: mercadopago | paypal
 */
const express = require('express');
const auth = require('../../middleware/auth');
const { requireCliente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const idempotency = require('../../middleware/idempotency');
const ah = require('../../utils/asyncHandler');
const { body, param } = require('../../utils/validators');
const { PROVEEDORES_PAGO } = require('../../utils/constants');
const svc = require('./payment.service');

const providerParam = param('provider').isIn(PROVEEDORES_PAGO).withMessage(`provider: ${PROVEEDORES_PAGO.join(', ')}`);

const payments = express.Router();
payments.use(auth, requireCliente);

payments.post('/:provider/create', idempotency(), validate([providerParam, body('order_id').isMongoId()]), ah(async (req, res) => {
  res.status(201).json(await svc.create(req.user, req.params.provider, req.body.order_id));
}));

payments.post('/:provider/capture', idempotency(), validate([
  providerParam, body('order_id').isMongoId(), body('referencia').isString().trim().isLength({ min: 1, max: 100 }),
]), ah(async (req, res) => {
  res.json(await svc.capture(req.user, req.params.provider, { order_id: req.body.order_id, referencia: req.body.referencia }));
}));

const webhooks = express.Router();
webhooks.post('/:provider', validate([providerParam]), ah(async (req, res) => {
  res.json(await svc.webhook(req.params.provider, req));
}));

module.exports = { paymentsRouter: payments, webhooksRouter: webhooks };
