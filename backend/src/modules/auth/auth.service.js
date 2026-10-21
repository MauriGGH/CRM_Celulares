/**
 * Autenticación: JWT de acceso (15 min clientes / 8 h staff) y refresh
 * token opaco con rotación. El refresh se guarda como HMAC-SHA256 para poder
 * revocarlo sin guardar el valor original.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../../config/env');
const RefreshToken = require('./refresh-token.model');
const users = require('../users/user.service');
const { verifyPassword } = require('../../utils/password');
const { unauthorized } = require('../../utils/errors');

const hashToken = (raw) => crypto.createHmac('sha256', config.jwt.refreshSecret).update(raw).digest('hex');

/** @param {{_id:any, rol:string, email:string, nombre:string}} user */
function signAccess(user) {
  const expiresIn = user.rol === 'cliente' ? config.jwt.clientExpiresIn : config.jwt.staffExpiresIn;
  const token = jwt.sign(
    { sub: String(user._id), rol: user.rol, email: user.email, nombre: user.nombre, typ: 'access' },
    config.jwtSecret,
    { expiresIn },
  );
  return { access_token: token, expires_in: jwt.decode(token).exp - Math.floor(Date.now() / 1000) };
}

async function issueRefresh(userId, userAgent) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const doc = await RefreshToken.create({
    user_id: userId,
    token_hash: hashToken(raw),
    expires_at: new Date(Date.now() + config.jwt.refreshDays * 86_400_000),
    user_agent: userAgent?.slice(0, 200),
  });
  return { raw, doc };
}

async function session(user, userAgent) {
  const { raw } = await issueRefresh(user._id, userAgent);
  return { ...signAccess(user), refresh_token: raw, user };
}

async function login(email, password, userAgent) {
  const user = await users.findByEmail(email);
  // Misma respuesta si no existe, está inactivo o la contraseña no coincide.
  if (!user || !user.is_active || !(await verifyPassword(password, user.password_hash))) {
    throw unauthorized('Credenciales incorrectas');
  }
  user.ultimo_login = new Date();
  await user.save();
  return session(user, userAgent);
}

async function register(data, userAgent) {
  const user = await users.createUser({ ...data, rol: 'cliente' });
  return session(user, userAgent);
}

/**
 * Rota el refresh token. Si llega uno ya revocado se asume robo y se
 * revocan todas las sesiones del usuario.
 */
async function refresh(raw, userAgent) {
  if (!raw) throw unauthorized('Refresh token requerido');
  const doc = await RefreshToken.findOne({ token_hash: hashToken(raw) });
  if (!doc || doc.expires_at < new Date()) throw unauthorized('Refresh token inválido o expirado');
  if (doc.revoked_at) {
    await RefreshToken.updateMany({ user_id: doc.user_id, revoked_at: null }, { revoked_at: new Date() });
    throw unauthorized('Refresh token reutilizado; inicia sesión de nuevo');
  }
  const user = await users.findById(doc.user_id);
  if (!user || !user.is_active) throw unauthorized('Usuario inactivo');
  const next = await issueRefresh(user._id, userAgent);
  doc.revoked_at = new Date();
  doc.replaced_by = next.doc._id;
  await doc.save();
  return { ...signAccess(user), refresh_token: next.raw, user };
}

async function logout(raw) {
  if (!raw) return;
  await RefreshToken.updateOne({ token_hash: hashToken(raw), revoked_at: null }, { revoked_at: new Date() });
}

module.exports = { login, register, refresh, logout, signAccess, hashToken };
