/**
 * Error de negocio con código estable para el frontend.
 * Lánzalo desde servicios; el errorHandler lo convierte en
 * { error: { code, message, details } } con el status indicado.
 */
class AppError extends Error {
  /**
   * @param {number} status código HTTP (400, 401, 403, 404, 409, 422)
   * @param {string} code código estable en MAYÚSCULAS, ej. STOCK_INSUFICIENTE
   * @param {string} message mensaje legible en español
   * @param {object} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = AppError;
