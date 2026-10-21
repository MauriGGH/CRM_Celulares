process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.INGEST_API_KEY = 'test-service-token';
process.env.MP_WEBHOOK_SECRET = 'test-mp-secret';
// Colas en el mismo proceso y rate limit en memoria: tests deterministas sin Redis.
process.env.QUEUE_MODE = 'inline';
delete process.env.REDIS_URL;
