/**
 * Fichas técnicas (gerente):
 *   GET  /admin/modelos?q=&marca=
 *   GET  /admin/modelos/:id               ObjectId o id numérico
 *   POST /admin/modelos/:id/import        { category_id?, variantes: [{ color, almacenamiento_gb, precio, sku? }] }
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requireGerente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ah = require('../../utils/asyncHandler');
const serialize = require('../../utils/serialize');
const { parsePagination, paginated } = require('../../utils/pagination');
const { body, query, param, pageQuery } = require('../../utils/validators');
const { isMoney } = require('../../utils/money');
const svc = require('./modelo.service');

router.use('/modelos', auth, requireGerente);

const idParam = param('id').matches(/^([0-9a-f]{24}|\d{1,9})$/i).withMessage('id inválido');

router.get('/modelos', validate([
  ...pageQuery,
  query('q').optional().isString().isLength({ max: 100 }),
  query('marca').optional().isString().isLength({ max: 50 }),
]), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.list(req.query, page);
  res.json(paginated(data, page, total));
}));

router.get('/modelos/:id', validate([idParam]), ah(async (req, res) => res.json(await svc.get(req.params.id))));

router.post('/modelos/:id/import', validate([
  idParam,
  body('category_id').optional().isMongoId(),
  body('variantes').isArray({ min: 1, max: 30 }),
  body('variantes.*.color').isString().trim().isLength({ min: 1, max: 50 }),
  body('variantes.*.almacenamiento_gb').isInt({ min: 1, max: 4096 }).toInt(),
  body('variantes.*.precio').custom(isMoney).withMessage('precio con formato "18999.00"'),
  body('variantes.*.sku').optional().isString().trim().isLength({ min: 3, max: 60 }),
]), ah(async (req, res) => {
  const variantes = req.body.variantes.map(({ color, almacenamiento_gb, precio, sku }) => ({ color, almacenamiento_gb, precio, sku }));
  const product = await svc.importAsDraft(req.user, req.params.id, { category_id: req.body.category_id, variantes });
  res.status(201).json(serialize(product));
}));

module.exports = router;
