/**
 * Promociones y cupones (gerente):
 *   GET    /admin/promotions
 *   POST   /admin/promotions
 *   PATCH  /admin/promotions/:id
 *   DELETE /admin/promotions/:id
 *   GET    /admin/discount-types
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requireGerente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ah = require('../../utils/asyncHandler');
const serialize = require('../../utils/serialize');
const { parsePagination, paginated } = require('../../utils/pagination');
const { body, objectIdParam, pageQuery } = require('../../utils/validators');
const { TIPOS_DESCUENTO } = require('../../utils/constants');
const svc = require('./promotion.service');

const FIELDS = ['nombre', 'descripcion', 'codigo', 'tipo_descuento', 'valor_descuento', 'cantidad_minima', 'aplicacion',
  'requiere_todos_productos', 'dias_semana', 'fecha_inicio', 'fecha_fin', 'activa', 'orden', 'imagen_url',
  'productos_aplicables', 'productos_beneficiados', 'usos_maximos'];
const pick = (b) => Object.fromEntries(FIELDS.filter((k) => b[k] !== undefined).map((k) => [k, b[k]]));

const rules = (optional) => {
  const f = (n) => (optional ? body(n).optional() : body(n));
  return [
    f('nombre').isString().trim().isLength({ min: 1, max: 120 }),
    f('tipo_descuento').isIn(TIPOS_DESCUENTO).withMessage(`tipo_descuento: ${TIPOS_DESCUENTO.join(', ')}`),
    f('fecha_inicio').isISO8601(),
    f('fecha_fin').isISO8601(),
    body('codigo').optional({ values: 'null' }).matches(/^[A-Za-z0-9_-]{3,30}$/).withMessage('codigo: 3-30 letras o números'),
    body('valor_descuento').optional().isFloat({ min: 0 }),
    body('cantidad_minima').optional().isInt({ min: 0 }),
    body('aplicacion').optional().isIn(['producto', 'total']),
    body('requiere_todos_productos').optional().isBoolean(),
    body('dias_semana').optional().matches(/^([0-6](,[0-6])*)?$/).withMessage('dias_semana: "0,1,2" (0 = lunes)'),
    body('activa').optional().isBoolean(),
    body('orden').optional().isInt(),
    body('productos_aplicables').optional().isArray(),
    body('productos_aplicables.*').isMongoId(),
    body('productos_beneficiados').optional().isArray(),
    body('productos_beneficiados.*').isMongoId(),
    body('usos_maximos').optional({ values: 'null' }).isInt({ min: 1 }),
  ];
};

router.use(['/promotions', '/discount-types'], auth, requireGerente);

router.get('/discount-types', (req, res) => res.json({ data: TIPOS_DESCUENTO }));

router.get('/promotions', validate(pageQuery), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.list(req.query, page);
  res.json(paginated(serialize(data), page, total));
}));

router.post('/promotions', validate(rules(false)), ah(async (req, res) => {
  res.status(201).json(serialize(await svc.create(req.user, pick(req.body))));
}));

router.patch('/promotions/:id', validate([objectIdParam(), ...rules(true)]), ah(async (req, res) => {
  res.json(serialize(await svc.update(req.user, req.params.id, pick(req.body))));
}));

router.delete('/promotions/:id', validate([objectIdParam()]), ah(async (req, res) => {
  await svc.remove(req.user, req.params.id);
  res.status(204).end();
}));

module.exports = router;
