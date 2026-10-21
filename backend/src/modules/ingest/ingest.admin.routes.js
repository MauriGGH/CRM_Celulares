/**
 * Revisión de ingesta (gerente):
 *   GET  /admin/ingest/batches
 *   GET  /admin/ingest/records?resultado=&decision=&source=&batch_id=
 *   POST /admin/ingest/records/:id/approve  { sku?, category_id? }
 *   POST /admin/ingest/records/:id/reject   { nota? }
 *   GET  /admin/competitor-prices?sku=&source=&desde=&hasta=
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requireGerente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ah = require('../../utils/asyncHandler');
const serialize = require('../../utils/serialize');
const { parsePagination, paginated } = require('../../utils/pagination');
const { body, query, objectIdParam, pageQuery } = require('../../utils/validators');
const { RESULTADOS_INGESTA, DECISIONES_INGESTA, ESTADOS_LOTE } = require('../../utils/constants');
const svc = require('./ingest.service');

router.use(['/ingest', '/competitor-prices'], auth, requireGerente);

router.get('/ingest/batches', validate([...pageQuery, query('status').optional().isIn(ESTADOS_LOTE)]), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.listBatches(req.query, page);
  res.json(paginated(serialize(data), page, total));
}));

router.get('/ingest/records', validate([
  ...pageQuery,
  query('resultado').optional().isIn(RESULTADOS_INGESTA),
  query('decision').optional().isIn(DECISIONES_INGESTA),
  query('batch_id').optional().isMongoId(),
]), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.listRecords(req.query, page);
  res.json(paginated(serialize(data), page, total));
}));

router.post('/ingest/records/:id/approve', validate([
  objectIdParam(),
  body('sku').optional().isString().trim().isLength({ min: 3, max: 60 }),
  body('category_id').optional().isMongoId(),
]), ah(async (req, res) => {
  res.json(serialize(await svc.approve(req.user, req.params.id, { sku: req.body.sku, category_id: req.body.category_id })));
}));

router.post('/ingest/records/:id/reject', validate([objectIdParam(), body('nota').optional().isString().isLength({ max: 500 })]), ah(async (req, res) => {
  res.json(serialize(await svc.reject(req.user, req.params.id, { nota: req.body.nota })));
}));

router.get('/competitor-prices', validate([
  query('sku').isString().notEmpty().withMessage('sku requerido'),
  query('desde').optional().isISO8601(),
  query('hasta').optional().isISO8601(),
]), ah(async (req, res) => {
  res.json(serialize(await svc.competitorPrices(req.query)));
}));

module.exports = router;
