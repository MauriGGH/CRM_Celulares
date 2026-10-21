/**
 * Envío de correos (cola `emails`). Sin SMTP_URL solo se registran en el log.
 */
const logger = require('./logger');

let transport = null;
function getTransport() {
  if (!process.env.SMTP_URL) return null;
  if (!transport) transport = require('nodemailer').createTransport(process.env.SMTP_URL);
  return transport;
}

/**
 * @param {{to:string, subject:string, text:string}} msg
 */
async function sendMail({ to, subject, text }) {
  const t = getTransport();
  if (!t) { logger.info({ to, subject }, 'correo (sin SMTP, solo log)'); return { logged: true }; }
  return t.sendMail({ from: process.env.MAIL_FROM || 'no-reply@crm-celulares.local', to, subject, text });
}

module.exports = { sendMail };
