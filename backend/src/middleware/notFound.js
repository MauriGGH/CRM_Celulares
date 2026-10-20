const AppError = require('../utils/AppError');

module.exports = (_req, _res, next) => next(new AppError(404, 'RUTA_NO_ENCONTRADA', 'Ruta no encontrada'));
