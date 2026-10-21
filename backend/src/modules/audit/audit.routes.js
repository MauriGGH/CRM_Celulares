/**
 * GET /admin/audit — bitácora con filtros (gerente, admin).
 * Filtros: accion, entidad, entidad_id, user_id, desde, hasta.
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requireGerente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ah = require('../../utils/asyncHandler');
const serialize = require('../../utils/serialize');
const { parsePagination, paginated } = require('../../utils/pagination');
const { query, pageQuery } = require('../../utils/validators');
const AuditLog = require('./audit-log.model');

router.get('/', auth, requireGerente, validate([
  ...pageQuery,
  query('user_id').optional().isMongoId(),
  query('desde').optional().isISO8601(),
  query('hasta').optional().isISO8601(),
]), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const filter = {};
  for (const k of ['accion', 'entidad', 'entidad_id', 'user_id']) if (req.query[k]) filter[k] = String(req.query[k]);
  if (req.query.desde || req.query.hasta) {
    filter.created_at = {};
    if (req.query.desde) filter.created_at.$gte = new Date(req.query.desde);
    if (req.query.hasta) filter.created_at.$lte = new Date(req.query.hasta);
  }
  const [data, total] = await Promise.all([
    AuditLog.find(filter).populate('user_id', 'nombre email rol').sort({ created_at: -1 }).skip(page.skip).limit(page.limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.json(paginated(serialize(data), page, total));
}));

module.exports = router;
