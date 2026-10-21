/**
 * Registro de todos los modelos (para seed, índices y tests).
 * Dentro de un módulo, importar el modelo propio directamente y usar el
 * `service` de otro módulo para sus datos.
 */
module.exports = {
  User: require('../modules/users/user.model'),
  RefreshToken: require('../modules/auth/refresh-token.model'),
  Brand: require('../modules/catalog/brand.model'),
  Category: require('../modules/catalog/category.model'),
  Product: require('../modules/catalog/product.model'),
  Warehouse: require('../modules/inventory/warehouse.model'),
  StockLevel: require('../modules/inventory/stock-level.model'),
  SerialUnit: require('../modules/inventory/serial-unit.model'),
  StockMovement: require('../modules/inventory/stock-movement.model'),
  Cart: require('../modules/cart/cart.model'),
  Order: require('../modules/orders/order.model'),
  Return: require('../modules/orders/return.model'),
  Payment: require('../modules/payments/payment.model'),
  WebhookEvent: require('../modules/payments/webhook-event.model'),
  Promotion: require('../modules/promotions/promotion.model'),
  AuditLog: require('../modules/audit/audit-log.model'),
  Setting: require('../modules/settings/setting.model'),
  IngestBatch: require('../modules/ingest/ingest-batch.model'),
  IngestRecord: require('../modules/ingest/ingest-record.model'),
  CompetitorPrice: require('../modules/ingest/competitor-price.model'),
  Modelo: require('../modules/modelos/modelo.model'),
  ApiClient: require('../modules/external/api-client.model'),
  ApiAccessLog: require('../modules/external/api-access-log.model'),
  ExportJob: require('../modules/external/export-job.model'),
  IdempotencyKey: require('./idempotency-key.model'),
  Counter: require('./counter.model'),
};
