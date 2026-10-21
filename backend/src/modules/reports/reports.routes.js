/**
 * Reportes (gerente):
 *   GET  /admin/reports/sales?desde&hasta
 *   GET  /admin/reports/inventory
 *   GET  /admin/reports/margins?desde&hasta
 *   POST /admin/reports/export  { tipo: sales|inventory|margins, formato: xlsx|pdf, desde?, hasta? }
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requireGerente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ah = require('../../utils/asyncHandler');
const { body, query } = require('../../utils/validators');
const svc = require('./report.service');

const rangeQuery = [query('desde').optional().isISO8601(), query('hasta').optional().isISO8601()];

router.use(auth, requireGerente);

router.get('/sales', validate(rangeQuery), ah(async (req, res) => res.json(await svc.sales(req.query))));
router.get('/inventory', ah(async (req, res) => res.json(await svc.inventoryReport())));
router.get('/margins', validate(rangeQuery), ah(async (req, res) => res.json(await svc.margins(req.query))));

router.post('/export', validate([
  body('tipo').isIn(['sales', 'inventory', 'margins']),
  body('formato').isIn(['xlsx', 'pdf']),
  body('desde').optional().isISO8601(),
  body('hasta').optional().isISO8601(),
]), ah(async (req, res) => {
  const { buffer, filename, contentType } = await svc.exportReport(req.body);
  res.set('Content-Type', contentType);
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}));

module.exports = router;
