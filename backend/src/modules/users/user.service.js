/**
 * Servicio de usuarios (empleados y clientes) y direcciones.
 */
const User = require('./user.model');
const { hashPassword } = require('../../utils/password');
const { notFound, forbidden, conflict, badRequest } = require('../../utils/errors');
const { STAFF_ROLES } = require('../../utils/constants');
const { logAccion } = require('../../utils/auditoria');

const findById = (id) => User.findById(id);
const findByEmail = (email) => User.findOne({ email: String(email).toLowerCase().trim() });

/**
 * @param {{email:string, password:string, nombre:string, telefono?:string, rol?:string}} data
 */
async function createUser({ email, password, nombre, telefono, rol = 'cliente' }) {
  if (await findByEmail(email)) throw conflict('EMAIL_REGISTRADO', 'Ese correo ya está registrado');
  return User.create({ email, password_hash: await hashPassword(password), nombre, telefono, rol });
}

/** Un gerente no puede crear, editar ni desactivar administradores. */
function assertCanManage(actor, targetRol) {
  if (actor.rol !== 'admin' && targetRol === 'admin') throw forbidden('Solo un admin puede gestionar administradores');
}

async function listStaff({ rol, q, is_active }, { skip, limit }) {
  const filter = { rol: rol || { $in: STAFF_ROLES } };
  if (q) filter.$or = [{ nombre: new RegExp(escapeRegex(q), 'i') }, { email: new RegExp(escapeRegex(q), 'i') }];
  if (is_active !== undefined) filter.is_active = is_active === 'true' || is_active === true;
  const [data, total] = await Promise.all([
    User.find(filter).select('-addresses').sort({ created_at: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return { data, total };
}

async function createStaff(actor, data) {
  if (!STAFF_ROLES.includes(data.rol)) throw badRequest('Rol de empleado inválido');
  assertCanManage(actor, data.rol);
  const user = await createUser(data);
  await logAccion(actor.id, 'usuario.crear', { email: user.email, rol: user.rol }, { entidad: 'user', entidadId: user.id });
  return user;
}

async function updateStaff(actor, id, changes) {
  const user = await User.findById(id);
  if (!user) throw notFound('Usuario');
  assertCanManage(actor, user.rol);
  if (changes.rol) {
    if (!STAFF_ROLES.includes(changes.rol)) throw badRequest('Rol de empleado inválido');
    assertCanManage(actor, changes.rol);
  }
  if (String(user._id) === String(actor.id) && (changes.is_active === false || (changes.rol && changes.rol !== user.rol))) {
    throw forbidden('No puedes desactivarte ni cambiar tu propio rol');
  }
  for (const k of ['nombre', 'telefono', 'rol', 'is_active']) if (changes[k] !== undefined) user[k] = changes[k];
  if (changes.password) user.password_hash = await hashPassword(changes.password);
  await user.save();
  await logAccion(actor.id, 'usuario.editar', { campos: Object.keys(changes).filter((k) => k !== 'password') }, { entidad: 'user', entidadId: user.id });
  return user;
}

// ─── Direcciones del cliente ───────────────────────────────────────────────

async function addAddress(userId, data) {
  const user = await User.findById(userId);
  if (!user) throw notFound('Usuario');
  if (data.es_principal || user.addresses.length === 0) {
    user.addresses.forEach((a) => { a.es_principal = false; });
    data.es_principal = true;
  }
  user.addresses.push(data);
  await user.save();
  return user.addresses[user.addresses.length - 1];
}

async function updateAddress(userId, addressId, data) {
  const user = await User.findById(userId);
  const addr = user?.addresses.id(addressId);
  if (!addr) throw notFound('Dirección');
  if (data.es_principal) user.addresses.forEach((a) => { a.es_principal = false; });
  addr.set(data);
  await user.save();
  return addr;
}

async function removeAddress(userId, addressId) {
  const user = await User.findById(userId);
  const addr = user?.addresses.id(addressId);
  if (!addr) throw notFound('Dirección');
  const eraPrincipal = addr.es_principal;
  addr.deleteOne();
  if (eraPrincipal && user.addresses.length) user.addresses[0].es_principal = true;
  await user.save();
}

async function getAddress(userId, addressId) {
  const user = await User.findById(userId).lean();
  const addr = (user?.addresses || []).find((a) => String(a._id) === String(addressId));
  if (!addr) throw notFound('Dirección');
  return addr;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  findById, findByEmail, createUser, listStaff, createStaff, updateStaff,
  addAddress, updateAddress, removeAddress, getAddress, escapeRegex,
};
