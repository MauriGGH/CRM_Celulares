/**
 * Exportación masiva asíncrona (B15): POST /external/v1/exports encola el job,
 * el worker recorre el recurso con el mismo cursor de la API, guarda el archivo
 * en GridFS (bucket `export_files`) y deja un enlace firmado por 24 h.
 */
const mongoose = require('mongoose');
const ExportJob = require('./export-job.model');
const svc = require('./external.service');
const { signedUrl } = require('./external.auth');
const { enqueue } = require('../../utils/queue');
const { toCsv } = require('../../utils/csv');
const { notFound, AppError } = require('../../utils/errors');
const logger = require('../../utils/logger');

const TTL_MS = 24 * 3600_000;
const MAX_ROWS = 200_000;
const SCOPE_POR_RECURSO = { products: 'catalog:read', stock: 'stock:read', prices: 'prices:read', sales: 'sales:read' };
const CONTENT_TYPE = {
  json: 'application/json',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'export_files' });

async function create(client, { resource, format, filters = {} }) {
  const scope = SCOPE_POR_RECURSO[resource];
  if (!client.scopes.includes(scope)) throw new AppError(403, 'SCOPE_INSUFICIENTE', `La llave no tiene el permiso ${scope}`, { requerido: scope });
  const job = await ExportJob.create({ client_id: client.id, resource, format, filters, expires_at: new Date(Date.now() + TTL_MS) });
  await enqueue('exports', 'generate', { exportId: job.id }, { jobId: `export-${job.id}` });
  return job;
}

function present(job) {
  const listo = job.status === 'listo' && job.expires_at > new Date();
  return {
    export_id: String(job._id),
    resource: job.resource,
    format: job.format,
    filters: job.filters,
    status: job.status === 'listo' && !listo ? 'vencido' : job.status,
    rows: job.rows ?? null,
    bytes: job.bytes ?? null,
    download_url: listo ? signedUrl(String(job._id), job.expires_at) : null,
    expires_at: job.expires_at,
    error: job.error || null,
    created_at: job.created_at,
  };
}

async function get(client, id) {
  const job = mongoose.isValidObjectId(id) && await ExportJob.findOne({ _id: id, client_id: client.id }).lean();
  if (!job) throw notFound('Exportación');
  return present(job);
}

/** Todas las filas del recurso, página por página. */
async function collect(resource, filters) {
  if (resource === 'sales') {
    const r = await svc.sales({ group_by: filters.group_by || 'day', from: filters.from, to: filters.to });
    return { rows: r.data, columns: svc.SALES_COLUMNS[r.group_by] };
  }
  const fn = { products: svc.products, stock: svc.stock, prices: svc.priceHistory }[resource];
  const columns = { products: svc.PRODUCT_COLUMNS, stock: svc.STOCK_COLUMNS, prices: svc.PRICE_COLUMNS }[resource];
  const rows = [];
  let cursor = null;
  do {
    const p = await fn({ ...filters, cursor, limit: 1000 });
    rows.push(...p.data);
    cursor = p.next_cursor;
    if (rows.length > MAX_ROWS) throw new Error(`Más de ${MAX_ROWS} filas: acota los filtros`);
  } while (cursor);
  return { rows, columns };
}

async function render(format, columns, rows) {
  if (format === 'json') return Buffer.from(JSON.stringify(rows));
  if (format === 'csv') return Buffer.from(toCsv(columns, rows));
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('datos');
  ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.max(12, c.length + 2) }));
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c, r[c] instanceof Date ? r[c].toISOString() : r[c]])));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Handler de la cola `exports`. Idempotente: un job ya listo no se repite. */
async function generate(exportId) {
  const job = await ExportJob.findOneAndUpdate({ _id: exportId, status: { $in: ['en_cola', 'fallido'] } }, { status: 'procesando', error: null }, { new: true });
  if (!job) return null;
  try {
    const { rows, columns } = await collect(job.resource, job.filters || {});
    const buf = await render(job.format, columns, rows);
    const filename = `${job.resource}-${job.created_at.toISOString().slice(0, 10)}-${job.id.slice(-6)}.${job.format}`;
    const fileId = await new Promise((resolve, reject) => {
      const up = bucket().openUploadStream(filename, { metadata: { export_id: job._id, contentType: CONTENT_TYPE[job.format] } });
      up.on('error', reject).on('finish', () => resolve(up.id));
      up.end(buf);
    });
    Object.assign(job, { status: 'listo', file_id: fileId, filename, rows: rows.length, bytes: buf.length });
    await job.save();
    logger.info({ exportId, rows: rows.length, bytes: buf.length }, 'exportación lista');
    return job;
  } catch (err) {
    await ExportJob.updateOne({ _id: job._id }, { status: 'fallido', error: err.message });
    throw err;
  }
}

/** Archivo para el enlace firmado. */
async function openDownload(id) {
  const job = await ExportJob.findById(id).lean();
  if (!job || job.status !== 'listo' || !job.file_id || job.expires_at < new Date()) throw notFound('Exportación');
  return { stream: bucket().openDownloadStream(job.file_id), filename: job.filename, contentType: CONTENT_TYPE[job.format], bytes: job.bytes };
}

/** Barrido: borra los archivos vencidos. */
async function sweepExpired() {
  const vencidos = await ExportJob.find({ status: 'listo', expires_at: { $lt: new Date() } }).limit(200).lean();
  for (const j of vencidos) {
    await bucket().delete(j.file_id).catch(() => {});
    await ExportJob.updateOne({ _id: j._id }, { status: 'vencido', file_id: null });
  }
  return vencidos.length;
}

module.exports = { create, get, generate, openDownload, sweepExpired, SCOPE_POR_RECURSO };
