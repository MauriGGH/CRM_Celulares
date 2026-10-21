/**
 * Usuarios:
 *   GET    /me                      perfil propio
 *   PATCH  /me                      nombre, teléfono, contraseña
 *   GET    /me/addresses            direcciones del cliente
 *   POST   /me/addresses
 *   PATCH  /me/addresses/:id
 *   DELETE /me/addresses/:id
 *   GET    /admin/users             empleados (gerente, admin)
 *   POST   /admin/users
 *   PATCH  /admin/users/:id
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requireGerente } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const ah = require('../../utils/asyncHandler');
const serialize = require('../../utils/serialize');
const { parsePagination, paginated } = require('../../utils/pagination');
const { body, objectIdParam, pageQuery } = require('../../utils/validators');
const { STAFF_ROLES } = require('../../utils/constants');
const { notFound } = require('../../utils/errors');
const { hashPassword } = require('../../utils/password');
const svc = require('./user.service');

const addressRules = (optional) => {
  const f = (name) => (optional ? body(name).optional() : body(name));
  return [
    f('nombre_destinatario').isString().trim().isLength({ min: 1, max: 120 }),
    f('calle').isString().trim().isLength({ min: 1, max: 200 }),
    f('ciudad').isString().trim().isLength({ min: 1, max: 120 }),
    f('estado').isString().trim().isLength({ min: 1, max: 120 }),
    f('cp').matches(/^\d{5}$/).withMessage('cp debe tener 5 dígitos'),
    body('numero').optional().isString().isLength({ max: 20 }),
    body('colonia').optional().isString().isLength({ max: 120 }),
    body('telefono').optional().isString().isLength({ max: 20 }),
    body('referencias').optional().isString().isLength({ max: 300 }),
    body('es_principal').optional().isBoolean(),
  ];
};
const pickAddress = (b) => {
  const out = {};
  for (const k of ['nombre_destinatario', 'telefono', 'calle', 'numero', 'colonia', 'ciudad', 'estado', 'cp', 'referencias', 'es_principal']) {
    if (b[k] !== undefined) out[k] = b[k];
  }
  return out;
};

// ─── Perfil propio ─────────────────────────────────────────────────────────
router.get('/me', auth, ah(async (req, res) => {
  const user = await svc.findById(req.user.id);
  if (!user) throw notFound('Usuario');
  res.json(serialize(user));
}));

router.patch('/me', auth, validate([
  body('nombre').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('telefono').optional().isString().isLength({ max: 20 }),
  body('password').optional().isString().isLength({ min: 8, max: 128 }).withMessage('mínimo 8 caracteres'),
]), ah(async (req, res) => {
  const user = await svc.findById(req.user.id);
  if (!user) throw notFound('Usuario');
  if (req.body.nombre !== undefined) user.nombre = req.body.nombre;
  if (req.body.telefono !== undefined) user.telefono = req.body.telefono;
  if (req.body.password) user.password_hash = await hashPassword(req.body.password);
  await user.save();
  res.json(serialize(user));
}));

router.get('/me/addresses', auth, ah(async (req, res) => {
  const user = await svc.findById(req.user.id);
  if (!user) throw notFound('Usuario');
  res.json({ data: serialize(user.addresses) });
}));

router.post('/me/addresses', auth, validate(addressRules(false)), ah(async (req, res) => {
  res.status(201).json(serialize(await svc.addAddress(req.user.id, pickAddress(req.body))));
}));

router.patch('/me/addresses/:id', auth, validate([objectIdParam(), ...addressRules(true)]), ah(async (req, res) => {
  res.json(serialize(await svc.updateAddress(req.user.id, req.params.id, pickAddress(req.body))));
}));

router.delete('/me/addresses/:id', auth, validate([objectIdParam()]), ah(async (req, res) => {
  await svc.removeAddress(req.user.id, req.params.id);
  res.status(204).end();
}));

// ─── Empleados (admin) ────────────────────────────────────────────────────
router.get('/admin/users', auth, requireGerente, validate(pageQuery), ah(async (req, res) => {
  const page = parsePagination(req.query);
  const { data, total } = await svc.listStaff(req.query, page);
  res.json(paginated(serialize(data), page, total));
}));

router.post('/admin/users', auth, requireGerente, validate([
  body('email').isEmail().withMessage('email inválido'),
  body('password').isString().isLength({ min: 8, max: 128 }).withMessage('mínimo 8 caracteres'),
  body('nombre').isString().trim().isLength({ min: 1, max: 120 }),
  body('rol').isIn(STAFF_ROLES).withMessage(`rol debe ser uno de: ${STAFF_ROLES.join(', ')}`),
  body('telefono').optional().isString().isLength({ max: 20 }),
]), ah(async (req, res) => {
  const { email, password, nombre, rol, telefono } = req.body;
  res.status(201).json(serialize(await svc.createStaff(req.user, { email, password, nombre, rol, telefono })));
}));

router.patch('/admin/users/:id', auth, requireGerente, validate([
  objectIdParam(),
  body('nombre').optional().isString().trim().isLength({ min: 1, max: 120 }),
  body('telefono').optional().isString().isLength({ max: 20 }),
  body('rol').optional().isIn(STAFF_ROLES),
  body('is_active').optional().isBoolean(),
  body('password').optional().isString().isLength({ min: 8, max: 128 }),
]), ah(async (req, res) => {
  const { nombre, telefono, rol, is_active, password } = req.body;
  res.json(serialize(await svc.updateStaff(req.user, req.params.id, { nombre, telefono, rol, is_active, password })));
}));

module.exports = router;
