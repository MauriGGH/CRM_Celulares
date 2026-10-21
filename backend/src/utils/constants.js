/**
 * Catálogos cerrados del dominio. Se usan en los enums de Mongoose,
 * en las validaciones de entrada y en docs/openapi.yaml.
 */
module.exports = {
  // Sin vendedor: la tienda es solo en línea.
  ROLES: ['admin', 'gerente', 'almacen', 'cliente'],
  STAFF_ROLES: ['admin', 'gerente', 'almacen'],
  CONDICIONES: ['nuevo', 'reacondicionado', 'usado'],
  ESTADOS_PRODUCTO: ['borrador', 'publicado', 'archivado'],
  TIPOS_ALMACEN: ['almacen', 'bodega_proveedor'],
  ESTADOS_SERIAL: ['disponible', 'reservado', 'vendido', 'devuelto', 'baja'],
  TIPOS_MOVIMIENTO: ['entrada', 'venta', 'ajuste', 'devolucion', 'traspaso'],
  CANALES: ['online'], // solo venta en línea (sin tienda física)
  ESTADOS_PEDIDO: ['pendiente_pago', 'pagado', 'preparando', 'enviado', 'entregado', 'cancelado', 'reembolsado'],
  PROVEEDORES_PAGO: ['mercadopago', 'paypal'],
  ESTADOS_PAGO: ['pendiente', 'aprobado', 'rechazado', 'reembolsado', 'requiere_reembolso'],
  ESTADOS_ENVIO: ['pendiente', 'enviado', 'entregado'],
  TIPOS_DEVOLUCION: ['devolucion', 'garantia'],
  ESTADOS_DEVOLUCION: ['solicitada', 'aprobada', 'rechazada', 'recibida', 'reembolsada'],
  TIPOS_DESCUENTO: ['Porcentaje', 'Monto fijo', '2x1', 'Combo precio fijo', 'Lleva X paga Y'],
  // API para sistemas externos (B15): permisos de solo lectura por llave.
  SCOPES_EXTERNOS: ['catalog:read', 'stock:read', 'prices:read', 'sales:read'],
  RECURSOS_EXPORT: ['products', 'stock', 'prices', 'sales'],
  FORMATOS_EXPORT: ['json', 'csv', 'xlsx'],
  ESTADOS_LOTE: ['en_cola', 'procesando', 'listo', 'fallido'],
  RESULTADOS_INGESTA: ['coincide', 'nuevo', 'conflicto', 'invalido'],
  DECISIONES_INGESTA: ['pendiente', 'aprobado', 'rechazado', 'no_aplica'],
};
