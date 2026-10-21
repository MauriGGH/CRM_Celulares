/**
 * Lee y valida las variables de entorno una sola vez.
 * El resto del código importa `env` en lugar de leer process.env directamente.
 */
require('dotenv').config({ quiet: true });

const nodeEnv = process.env.NODE_ENV || 'development';
const isTest = nodeEnv === 'test';
const isProd = nodeEnv === 'production';

const required = ['MONGO_URI', 'JWT_SECRET'];
if (!isTest) {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`);
  }
}

const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));
const redisUrl = process.env.REDIS_URL || (isTest ? '' : 'redis://localhost:6379');

module.exports = {
  nodeEnv,
  isTest,
  isProd,
  port: Number(process.env.PORT) || 3001,
  mongoUri: process.env.MONGO_URI,
  // Si viene, gana sobre la base de la URI (staging usa crm_celulares_staging).
  mongoDbName: process.env.MONGO_DB_NAME || 'crm_celulares',
  // Imágenes subidas cuando no hay S3 (en producción, volumen que sirve Caddy en /media).
  mediaDir: process.env.MEDIA_DIR || require('path').join(__dirname, '../../public'),
  // Saltos de proxy de confianza (Cloudflare Tunnel → Caddy → API).
  trustProxy: /^\d+$/.test(process.env.TRUST_PROXY || '') ? Number(process.env.TRUST_PROXY) : (process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal'),
  redisUrl,
  // inline: los jobs corren en el mismo proceso (tests o dev sin Redis).
  queueMode: process.env.QUEUE_MODE || (redisUrl ? 'bullmq' : 'inline'),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  // URL pública del frontend (regreso de Mercado Pago / PayPal) y de la API (webhooks).
  publicUrl: (process.env.PUBLIC_URL || process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0].replace(/\/$/, ''),
  apiPublicUrl: (process.env.API_PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, ''),
  // Host de la API para sistemas externos (B15); enlaces firmados de exportación.
  externalPublicUrl: (process.env.EXTERNAL_PUBLIC_URL || process.env.API_PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, ''),

  jwtSecret: process.env.JWT_SECRET || (isTest ? 'test-secret' : undefined),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  jwt: {
    staffExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
    clientExpiresIn: process.env.JWT_CLIENT_EXPIRES_IN || '15m',
    // Pimienta para el hash de los refresh tokens guardados en la BD.
    refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'test-refresh-secret',
    refreshDays: int(process.env.REFRESH_TOKEN_DAYS, 30),
  },

  reservaMinutos: int(process.env.RESERVA_MINUTOS, 15),

  // Infra lo entrega como INGEST_API_KEY; se acepta también INGEST_SERVICE_TOKEN.
  ingestServiceToken: process.env.INGEST_API_KEY || process.env.INGEST_SERVICE_TOKEN,
  ingest: {
    // Similitud mínima (0–1) para sugerir una variante en conflicto.
    reviewSimilarity: parseFloat(process.env.INGEST_REVIEW_SIMILARITY || '0.5'),
  },

  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    secret: process.env.PAYPAL_CLIENT_SECRET || '',
    mode: process.env.PAYPAL_MODE || 'sandbox',
    webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
  },
  mercadopago: {
    accessToken: process.env.MP_ACCESS_TOKEN || process.env.MERCADOPAGO_ACCESS_TOKEN || '',
    webhookSecret: process.env.MP_WEBHOOK_SECRET || '',
  },

  s3: {
    bucket: process.env.S3_BUCKET || '',
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY || '',
    publicUrl: (process.env.S3_PUBLIC_URL || '').replace(/\/$/, ''),
  },

  sentryDsn: process.env.SENTRY_DSN || '',
};
