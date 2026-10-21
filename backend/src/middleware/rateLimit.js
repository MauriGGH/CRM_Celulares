'use strict';

/**
 * Rate limit por ventana fija. Con REDIS_URL usa Redis (límite compartido
 * entre réplicas de la API); sin Redis cae a memoria por proceso.
 */
const { getRedis } = require('../config/redis');
const { AppError } = require('../utils/errors');

const _stamps = new Map();
exports._stamps = _stamps; // expuesto para tests

/**
 * Cuenta un evento para `key` y dice si se pasó del límite.
 * @param {string} key
 * @param {number} limit
 * @param {number} windowMs
 * @returns {Promise<null|{retryAfter:number}>}
 */
async function consume(key, limit, windowMs) {
  const redis = getRedis();
  if (redis) {
    const k = `rl:${key}`;
    const [[, count], [, ttl]] = await redis.multi().incr(k).pttl(k).exec();
    if (ttl < 0) await redis.pexpire(k, windowMs);
    if (count > limit) return { retryAfter: Math.max(1, Math.ceil((ttl > 0 ? ttl : windowMs) / 1000)) };
    return null;
  }
  const now = Date.now();
  const list = (_stamps.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    _stamps.set(key, list);
    return { retryAfter: Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000)) };
  }
  list.push(now);
  _stamps.set(key, list);
  return null;
}
exports.consume = consume;

/**
 * Como `consume`, pero devuelve el estado para los encabezados RateLimit-*.
 * @returns {Promise<{limit:number, remaining:number, reset:number, blocked:boolean}>} reset en segundos
 */
async function hit(key, limit, windowMs) {
  const redis = getRedis();
  let count;
  let resetMs;
  if (redis) {
    const k = `rl:${key}`;
    const [[, c], [, ttl]] = await redis.multi().incr(k).pttl(k).exec();
    if (ttl < 0) await redis.pexpire(k, windowMs);
    count = c;
    resetMs = ttl > 0 ? ttl : windowMs;
  } else {
    const now = Date.now();
    const list = (_stamps.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length < limit) list.push(now);
    else list.overflow = true;
    _stamps.set(key, list);
    count = list.overflow ? limit + 1 : list.length;
    resetMs = windowMs - (now - list[0]);
  }
  return { limit, remaining: Math.max(0, limit - count), reset: Math.max(1, Math.ceil(resetMs / 1000)), blocked: count > limit };
}
exports.hit = hit;

/**
 * IP del cliente: Cloudflare la manda en CF-Connecting-IP (el túnel llega a
 * Caddy y Caddy a la API); si no viene, req.ip según `trust proxy`.
 */
function clientIp(req) {
  return req.get('cf-connecting-ip') || req.ip || req.socket?.remoteAddress || 'unknown';
}
exports.clientIp = clientIp;

/**
 * Factory de middleware Express para limitar intentos por IP. Pensado para
 * endpoints públicos sensibles (ej. /auth/login) y mitigar fuerza bruta.
 * @param {{limit?:number, windowMs?:number, prefix?:string}} opts
 * @returns {import('express').RequestHandler}
 */
function ipRateLimit({ limit = 10, windowMs = 5 * 60_000, prefix = 'ip' } = {}) {
  return async (req, res, next) => {
    try {
      const ip = clientIp(req);
      const blocked = await consume(`${prefix}:${ip}`, limit, windowMs);
      if (blocked) {
        res.set('Retry-After', String(blocked.retryAfter));
        return next(new AppError(429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos. Intenta más tarde.', blocked));
      }
      next();
    } catch (err) { next(err); }
  };
}
exports.ipRateLimit = ipRateLimit;
