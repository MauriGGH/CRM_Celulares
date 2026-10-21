/**
 * Helper para registrar acciones de auditoría (reutilizado de Mochi Matcha).
 */
const AuditLog = require('../modules/audit/audit-log.model');
const logger = require('./logger');

/**
 * Registra una entrada en `audit_logs`.
 * Falla silenciosa: si el insert revienta, loguea y devuelve null para no
 * romper el flujo principal que lo invoca.
 *
 * @param {string|null} userId usuario responsable (null para acciones del sistema)
 * @param {string} accion etiqueta corta (ej. 'precio.cambio', 'pedido.estado')
 * @param {object} [detalle] objeto serializable
 * @param {{entidad?:string, entidadId?:string, ip?:string, session?:import('mongoose').ClientSession}} [refs]
 */
async function logAccion(userId, accion, detalle = {}, refs = {}) {
  try {
    const [doc] = await AuditLog.create([{
      user_id: userId || null,
      accion,
      detalle,
      entidad: refs.entidad,
      entidad_id: refs.entidadId ? String(refs.entidadId) : undefined,
      ip: refs.ip,
    }], refs.session ? { session: refs.session } : {});
    return doc;
  } catch (e) {
    if (refs.session) throw e; // dentro de una transacción el error debe abortarla
    logger.error({ err: e }, 'auditoria.logAccion falló');
    return null;
  }
}

module.exports = { logAccion };
