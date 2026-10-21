const { body, query, objectIdParam, money, optionalMoney } = require('../../utils/validators');
const { CONDICIONES, ESTADOS_PRODUCTO } = require('../../utils/constants');

const SORTS = ['relevancia', 'nuevos', 'precio_asc', 'precio_desc', 'nombre'];

const listPublic = [
  query('q').optional().isString().isLength({ max: 100 }),
  query('brand').optional().isSlug(),
  query('category').optional().isSlug(),
  query('min_price').optional().isDecimal({ decimal_digits: '0,2' }),
  query('max_price').optional().isDecimal({ decimal_digits: '0,2' }),
  query('storage_gb').optional().isInt({ min: 1 }),
  query('condition').optional().isIn(CONDICIONES),
  query('sort').optional().isIn(SORTS).withMessage(`sort: ${SORTS.join(', ')}`),
];

const variantRules = (prefix = '', optional = false) => {
  const f = (n) => (optional ? body(`${prefix}${n}`).optional() : body(`${prefix}${n}`));
  return [
    f('sku').isString().trim().matches(/^[A-Za-z0-9-_]{3,60}$/).withMessage('sku: 3-60 letras, números o guiones'),
    f('color').isString().trim().isLength({ min: 1, max: 60 }),
    f('almacenamiento_gb').isInt({ min: 0, max: 4096 }),
    body(`${prefix}ram_gb`).optional().isInt({ min: 0, max: 64 }),
    optional ? optionalMoney(`${prefix}precio`) : money(`${prefix}precio`),
    optionalMoney(`${prefix}precio_antes`),
    optionalMoney(`${prefix}costo`),
    body(`${prefix}gtin`).optional({ values: 'null' }).matches(/^\d{8,14}$/).withMessage('gtin: 8 a 14 dígitos'),
    body(`${prefix}is_active`).optional().isBoolean(),
    body(`${prefix}images`).optional().isArray({ max: 20 }),
  ];
};

const productRules = (optional) => {
  const f = (n) => (optional ? body(n).optional() : body(n));
  return [
    f('brand_id').isMongoId(),
    f('category_id').isMongoId(),
    f('modelo').isString().trim().isLength({ min: 1, max: 120 }),
    body('slug').optional().isSlug(),
    body('descripcion').optional().isString().isLength({ max: 5000 }),
    body('specs').optional().isObject(),
    body('condicion').optional().isIn(CONDICIONES),
    body('garantia_meses').optional().isInt({ min: 0, max: 60 }),
    body('estado').optional().isIn(ESTADOS_PRODUCTO),
    ...(optional ? [] : [body('variants').optional().isArray({ max: 50 }), ...variantRules('variants.*.')]),
  ];
};

module.exports = {
  listPublic,
  createProduct: productRules(false),
  updateProduct: [objectIdParam(), ...productRules(true)],
  createVariant: [objectIdParam(), ...variantRules()],
  updateVariant: [objectIdParam(), objectIdParam('variantId'), ...variantRules('', true)],
  addImage: [
    objectIdParam(),
    body('url').isURL({ require_tld: false, protocols: ['http', 'https'] }).withMessage('url inválida')
      .bail().isLength({ max: 1000 }),
    body('sku').optional().isString(),
    body('orden').optional().isInt({ min: 0 }),
  ],
  brand: (optional) => [
    (optional ? body('nombre').optional() : body('nombre')).isString().trim().isLength({ min: 1, max: 60 }),
    body('slug').optional().isSlug(),
    body('logo_url').optional().isURL({ require_tld: false }),
  ],
  category: (optional) => [
    (optional ? body('nombre').optional() : body('nombre')).isString().trim().isLength({ min: 1, max: 60 }),
    body('slug').optional().isSlug(),
    body('parent_id').optional({ values: 'null' }).isMongoId(),
  ],
};
