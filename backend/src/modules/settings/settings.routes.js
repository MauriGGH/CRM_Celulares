/**
 * Configuración (gerente, admin):
 *   GET /admin/settings   todas las claves con su valor (o el default)
 *   PUT /admin/settings   { clave: valor, … } solo claves conocidas
 */
const router = require('express').Router();
const auth = require('../../middleware/auth');
const { requireGerente } = require('../../middleware/authorize');
const ah = require('../../utils/asyncHandler');
const { allConfig, setConfig, DEFAULTS } = require('../../utils/configuracion');
const { isMoney } = require('../../utils/money');
const { badRequest } = require('../../utils/errors');
const { logAccion } = require('../../utils/auditoria');
const mongoose = require('mongoose');

/** Validación por clave. */
const CHECKS = {
  costo_envio: (v) => isMoney(v) || 'monto "199.00"',
  envio_gratis_desde: (v) => v === null || isMoney(v) || 'monto o null',
  stock_bajo_umbral: (v) => (Number.isInteger(v) && v >= 0) || 'entero ≥ 0',
  dias_devolucion: (v) => (Number.isInteger(v) && v >= 0 && v <= 365) || 'entero 0–365',
  almacen_online_id: (v) => v === null || mongoose.isValidObjectId(v) || 'id de almacén o null',
  nombre_tienda: (v) => (typeof v === 'string' && v.length <= 80) || 'texto ≤ 80',
};

router.use(auth, requireGerente);

router.get('/', ah(async (req, res) => res.json(await allConfig())));

router.put('/', ah(async (req, res) => {
  const body = req.body || {};
  const errors = {};
  for (const [k, v] of Object.entries(body)) {
    if (!(k in DEFAULTS)) { errors[k] = 'clave desconocida'; continue; }
    const ok = CHECKS[k] ? CHECKS[k](v) : true;
    if (ok !== true) errors[k] = ok;
  }
  if (!Object.keys(body).length) throw badRequest('Envía al menos una clave');
  if (Object.keys(errors).length) throw badRequest('Validación falló', errors);
  const antes = await allConfig();
  for (const [k, v] of Object.entries(body)) await setConfig(k, v);
  await logAccion(req.user.id, 'configuracion.cambio', {
    cambios: Object.fromEntries(Object.keys(body).map((k) => [k, { antes: antes[k], despues: body[k] }])),
  }, { entidad: 'settings' });
  res.json(await allConfig());
}));

module.exports = router;
