/**
 * Procesamiento de lotes del scraper (B12).
 *
 * Empate de cada registro con una variante propia, en este orden:
 *   0. Un registro anterior del mismo (source, external_id) ya aprobado por el gerente.
 *   1. gtin exacto.
 *   2. match_key exacto (marca|modelo|almacenamiento|color normalizado).
 *   3. Similitud por trigramas del modelo dentro de la misma marca: si supera
 *      INGEST_REVIEW_SIMILARITY queda `conflicto` con el SKU sugerido; si no, `nuevo`.
 * `coincide` guarda el precio en competitor_prices; `nuevo` y `conflicto`
 * quedan `pendiente` para el gerente. Nunca se cambian precios de venta ni se
 * publica nada.
 */
const IngestBatch = require('./ingest-batch.model');
const IngestRecord = require('./ingest-record.model');
const CompetitorPrice = require('./competitor-price.model');
const catalog = require('../catalog/catalog.service');
const env = require('../../config/env');
const { validateRecord } = require('./ingest.validator');
const { similarity } = require('../../utils/similarity');
const { toDecimal, toCents } = require('../../utils/money');
const { logAccion } = require('../../utils/auditoria');
const { notFound, conflict, badRequest } = require('../../utils/errors');
const logger = require('../../utils/logger');

// ─── Empate ───────────────────────────────────────────────────────────────

/**
 * @param {object} rec registro válido del contrato
 * @returns {Promise<{resultado:'coincide'|'nuevo'|'conflicto', sku?:string, product_id?:any, similitud?:number, motivo?:string}>}
 */
async function match(rec, source) {
  const previo = await IngestRecord.findOne({ source, external_id: rec.external_id, decision: 'aprobado', sku: { $ne: null } })
    .sort({ revisado_en: -1 }).lean();
  if (previo) {
    const f = await catalog.findBySku(previo.sku);
    if (f) return { resultado: 'coincide', sku: f.variant.sku, product_id: f.product._id, motivo: 'aprobado antes por el gerente' };
  }

  if (rec.gtin) {
    const p = await catalog.findByGtin(rec.gtin);
    if (p) {
      const v = p.variants.find((x) => x.gtin === rec.gtin);
      if (catalog.norm(p.brand_nombre) !== catalog.norm(rec.brand)) {
        return { resultado: 'conflicto', sku: v.sku, product_id: p._id, motivo: `gtin coincide pero la marca es ${p.brand_nombre}` };
      }
      return { resultado: 'coincide', sku: v.sku, product_id: p._id, motivo: 'gtin' };
    }
  }

  if (rec.storage_gb && rec.color) {
    const key = catalog.matchKey(rec.brand, rec.model, rec.storage_gb, rec.color);
    const p = await catalog.findByMatchKey(key);
    if (p) {
      const v = p.variants.find((x) => x.match_key === key);
      return { resultado: 'coincide', sku: v.sku, product_id: p._id, motivo: 'match_key' };
    }
  }

  // Respaldo difuso dentro de la marca.
  const candidatos = await catalog.findByBrandName(rec.brand);
  let best = null;
  for (const p of candidatos) {
    const sim = similarity(p.modelo, rec.model);
    for (const v of p.variants) {
      let score = sim;
      if (rec.storage_gb && v.almacenamiento_gb !== rec.storage_gb) score *= 0.8;
      if (rec.color && catalog.norm(v.color) !== catalog.norm(rec.color)) score *= 0.9;
      if (!best || score > best.score) best = { score, sku: v.sku, product_id: p._id };
    }
  }
  if (best && best.score >= env.ingest.reviewSimilarity) {
    return { resultado: 'conflicto', sku: best.sku, product_id: best.product_id, similitud: Math.round(best.score * 1000) / 1000, motivo: 'empate aproximado: revisar' };
  }
  return { resultado: 'nuevo', similitud: best ? Math.round(best.score * 1000) / 1000 : 0 };
}

async function savePrice({ sku, product_id, source, rec, capturedAt, recordId }) {
  await CompetitorPrice.create({
    captured_at: capturedAt,
    meta: { sku, source },
    product_id,
    precio: toDecimal(toCents(rec.price)),
    en_stock: rec.in_stock,
    url: rec.source_url,
    ingest_record_id: recordId,
  });
}

// ─── Lote ─────────────────────────────────────────────────────────────────

/** Procesa un lote `en_cola`. Idempotente: un lote `listo` no se reprocesa. */
async function processBatch(batchId) {
  const batch = await IngestBatch.findOneAndUpdate(
    { _id: batchId, status: { $in: ['en_cola', 'fallido'] } },
    { status: 'procesando', error: null },
    { new: true },
  ).select('+records');
  if (!batch) return null;

  try {
    const stats = { coincide: 0, nuevo: 0, conflicto: 0, invalido: 0 };
    const vistos = new Set();
    for (const rec of batch.records || []) {
      const base = { batch_id: batch._id, source: batch.source, external_id: rec?.external_id, source_url: rec?.source_url, payload: rec };
      const { valid, motivo } = validateRecord(rec);
      if (!valid || vistos.has(rec.external_id)) {
        stats.invalido++;
        await IngestRecord.create({ ...base, resultado: 'invalido', motivo: valid ? 'external_id repetido en el lote' : motivo, decision: 'no_aplica' });
        continue;
      }
      vistos.add(rec.external_id);

      const m = await match(rec, batch.source);
      stats[m.resultado]++;
      const data = {
        ...base, resultado: m.resultado, motivo: m.motivo, sku: m.sku || null, product_id: m.product_id || null,
        similitud: m.similitud, decision: m.resultado === 'coincide' ? 'no_aplica' : 'pendiente',
      };
      let saved;
      if (m.resultado === 'coincide') {
        saved = await IngestRecord.create(data);
        await savePrice({ ...m, source: batch.source, rec, capturedAt: batch.scraped_at, recordId: saved._id });
      } else {
        // Un pendiente previo del mismo listado se actualiza en vez de duplicarse en la cola.
        saved = await IngestRecord.findOneAndUpdate(
          { source: batch.source, external_id: rec.external_id, decision: 'pendiente' },
          data, { new: true, upsert: true },
        );
      }
    }
    batch.stats = stats;
    batch.status = 'listo';
    batch.processed_at = new Date();
    batch.records = undefined; // ya viven en ingest_records
    await batch.save();
    logger.info({ batchId: String(batch._id), stats }, 'lote de ingesta procesado');
    return batch;
  } catch (err) {
    await IngestBatch.updateOne({ _id: batch._id }, { status: 'fallido', error: err.message });
    throw err;
  }
}

async function getBatch(id) {
  const batch = await IngestBatch.findById(id).lean();
  if (!batch) return null;
  const invalidos = await IngestRecord.find({ batch_id: batch._id, resultado: 'invalido' })
    .select('external_id motivo').limit(1000).lean();
  return { batch, invalidos: invalidos.map((r) => ({ external_id: r.external_id ?? null, motivo: r.motivo })) };
}

async function listBatches(q, { skip, limit }) {
  const filter = {};
  if (q.source) filter.source = q.source;
  if (q.status) filter.status = q.status;
  const [data, total] = await Promise.all([
    IngestBatch.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
    IngestBatch.countDocuments(filter),
  ]);
  return { data, total };
}

// ─── Revisión del gerente ─────────────────────────────────────────────────

async function listRecords(q, { skip, limit }) {
  const filter = {};
  for (const k of ['resultado', 'decision', 'source', 'batch_id']) if (q[k]) filter[k] = q[k];
  const [data, total] = await Promise.all([
    IngestRecord.find(filter).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
    IngestRecord.countDocuments(filter),
  ]);
  return { data, total };
}

/**
 * Aprueba un registro pendiente.
 *  - conflicto (o nuevo con `sku`): lo liga a esa variante y guarda el precio.
 *  - nuevo sin `sku`: crea un producto en `borrador` (nunca publicado).
 */
async function approve(actor, id, { sku, category_id }) {
  const rec = await IngestRecord.findById(id);
  if (!rec) throw notFound('Registro');
  if (rec.decision !== 'pendiente') throw conflict('REGISTRO_YA_REVISADO', `El registro está ${rec.decision}`);
  const batch = await IngestBatch.findById(rec.batch_id).lean();
  const capturedAt = batch?.scraped_at || rec.created_at;

  let linkSku = sku || (rec.resultado === 'conflicto' ? rec.sku : null);
  let productId;
  if (linkSku) {
    const f = await catalog.findBySku(linkSku);
    if (!f) throw badRequest('SKU inexistente', { sku: linkSku });
    linkSku = f.variant.sku;
    productId = f.product._id;
  } else {
    const { product, sku: nuevo } = await catalog.createDraftFromIngest(actor, rec, { category_id });
    linkSku = nuevo;
    productId = product._id;
    rec.product_creado_id = product._id;
  }

  rec.decision = 'aprobado';
  rec.sku = linkSku;
  rec.product_id = productId;
  rec.revisado_por = actor.id;
  rec.revisado_en = new Date();
  await rec.save();
  await savePrice({ sku: linkSku, product_id: productId, source: rec.source, rec: rec.payload, capturedAt, recordId: rec._id });
  await logAccion(actor.id, 'ingesta.aprobar', { sku: linkSku, resultado: rec.resultado, creado: !!rec.product_creado_id }, { entidad: 'ingest_record', entidadId: rec.id });
  return rec;
}

async function reject(actor, id, { nota }) {
  const rec = await IngestRecord.findOneAndUpdate(
    { _id: id, decision: 'pendiente' },
    { decision: 'rechazado', revisado_por: actor.id, revisado_en: new Date(), nota_revision: nota },
    { new: true },
  );
  if (!rec) {
    if (!(await IngestRecord.exists({ _id: id }))) throw notFound('Registro');
    throw conflict('REGISTRO_YA_REVISADO', 'El registro ya fue revisado');
  }
  await logAccion(actor.id, 'ingesta.rechazar', { nota }, { entidad: 'ingest_record', entidadId: rec.id });
  return rec;
}

/** Histórico de precios de la competencia de un SKU, con el último por fuente. */
async function competitorPrices({ sku, source, desde, hasta }) {
  const f = await catalog.findBySku(sku);
  if (!f) throw notFound('SKU');
  const filter = { 'meta.sku': f.variant.sku };
  if (source) filter['meta.source'] = source;
  if (desde || hasta) {
    filter.captured_at = {};
    if (desde) filter.captured_at.$gte = new Date(desde);
    if (hasta) filter.captured_at.$lte = new Date(hasta);
  }
  const historial = await CompetitorPrice.find(filter).sort({ captured_at: -1 }).limit(500).lean();
  const ultimo = new Map();
  for (const h of historial) if (!ultimo.has(h.meta.source)) ultimo.set(h.meta.source, h);
  return {
    sku: f.variant.sku,
    nombre: catalog.variantLabel(f.product, f.variant),
    precio_propio: f.variant.precio,
    ultimo_por_fuente: [...ultimo.values()].map((h) => ({ source: h.meta.source, precio: h.precio, en_stock: h.en_stock, captured_at: h.captured_at, url: h.url })),
    historial: historial.map((h) => ({ source: h.meta.source, precio: h.precio, en_stock: h.en_stock, captured_at: h.captured_at })),
  };
}

module.exports = { match, processBatch, getBatch, listBatches, listRecords, approve, reject, competitorPrices };
