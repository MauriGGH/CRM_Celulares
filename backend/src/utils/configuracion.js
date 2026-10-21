/**
 * Lectura de configuración (colección `settings`) con valores por defecto.
 * Reutilizado de Mochi Matcha; se quitan horarios de atención.
 */
const Setting = require('../modules/settings/setting.model');

/** Valores por defecto de cada clave conocida. */
const DEFAULTS = {
  costo_envio: '199.00',
  envio_gratis_desde: '5000.00',
  stock_bajo_umbral: 3,
  almacen_online_id: null, // null = el almacén con más stock
  nombre_tienda: 'CRM Celulares',
  dias_devolucion: 30,
};

/**
 * @param {string} clave
 * @param {*} [fallback]
 */
async function getConfig(clave, fallback = DEFAULTS[clave]) {
  const s = await Setting.findOne({ clave }).lean();
  return s && s.valor !== undefined && s.valor !== null ? s.valor : fallback;
}

/**
 * Upsert de configuración. Idempotente.
 * @param {string} clave
 * @param {*} valor
 */
async function setConfig(clave, valor) {
  return Setting.findOneAndUpdate({ clave }, { valor }, { upsert: true, new: true });
}

/** Todas las claves, con defaults para las que no existen. */
async function allConfig() {
  const rows = await Setting.find().lean();
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.clave] = r.valor;
  return out;
}

async function getConfigInt(clave, fallback = DEFAULTS[clave] ?? 0) {
  const n = parseInt(await getConfig(clave, fallback), 10);
  return Number.isNaN(n) ? fallback : n;
}

module.exports = { getConfig, setConfig, allConfig, getConfigInt, DEFAULTS };
