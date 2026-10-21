/**
 * Paginación estándar: ?page=1&limit=20 (máximo 100).
 * Devuelve { page, limit, skip } y `paginated()` arma la respuesta
 * { data, meta: { page, limit, total } }.
 */
function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function paginated(data, { page, limit }, total) {
  return { data, meta: { page, limit, total } };
}

module.exports = { parsePagination, paginated };
