/**
 * Autenticación (clientes y staff):
 *   POST /auth/register  público, crea cliente
 *   POST /auth/login     público, 5 intentos por minuto por IP
 *   POST /auth/refresh   rota el refresh token (cookie httpOnly)
 *   POST /auth/logout    revoca el refresh token
 *   GET  /auth/me        payload del token vigente
 */
const router = require('express').Router();
const config = require('../../config/env');
const auth = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const { ipRateLimit } = require('../../middleware/rateLimit');
const ah = require('../../utils/asyncHandler');
const serialize = require('../../utils/serialize');
const { body } = require('../../utils/validators');
const svc = require('./auth.service');

const COOKIE = 'refresh_token';
const cookieOpts = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: config.jwt.refreshDays * 86_400_000,
});

function sendSession(res, status, s) {
  res.cookie(COOKIE, s.refresh_token, cookieOpts());
  res.status(status).json({
    access_token: s.access_token,
    token_type: 'Bearer',
    expires_in: s.expires_in,
    user: serialize({ _id: s.user._id, email: s.user.email, nombre: s.user.nombre, rol: s.user.rol }),
  });
}

const readRefresh = (req) => req.cookies?.[COOKIE] || req.body?.refresh_token;

router.post('/register', ipRateLimit({ limit: 10, windowMs: 60_000, prefix: 'register' }), validate([
  body('email').isEmail().withMessage('email inválido'),
  body('password').isString().isLength({ min: 8, max: 128 }).withMessage('mínimo 8 caracteres'),
  body('nombre').isString().trim().isLength({ min: 1, max: 120 }).withMessage('nombre requerido'),
  body('telefono').optional().isString().isLength({ max: 20 }),
]), ah(async (req, res) => {
  const { email, password, nombre, telefono } = req.body;
  sendSession(res, 201, await svc.register({ email, password, nombre, telefono }, req.get('user-agent')));
}));

router.post('/login', ipRateLimit({ limit: 5, windowMs: 60_000, prefix: 'login' }), validate([
  body('email').isEmail().withMessage('email inválido'),
  body('password').isString().notEmpty().withMessage('contraseña requerida'),
]), ah(async (req, res) => {
  sendSession(res, 200, await svc.login(req.body.email, req.body.password, req.get('user-agent')));
}));

router.post('/refresh', ah(async (req, res) => {
  sendSession(res, 200, await svc.refresh(readRefresh(req), req.get('user-agent')));
}));

router.post('/logout', ah(async (req, res) => {
  await svc.logout(readRefresh(req));
  res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
  res.status(204).end();
}));

router.get('/me', auth, (req, res) => res.json(req.user));

module.exports = router;
