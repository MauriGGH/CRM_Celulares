/**
 * Endpoints internos de ingesta (los consume solo el scraper).
 *
 * POST /internal/v1/ingest/batches     → valida el sobre, guarda el lote, lo encola y responde 202.
 * GET  /internal/v1/ingest/batches/:id → estado, conteos y motivo de cada inválido.
 *
 * Cada registro se valida y empata en el worker (cola `ingest`, ver ingest.service.js).
 */
const mongoose = require('mongoose');
const IngestBatch = require('./ingest-batch.model');
const { validateEnvelope } = require('./ingest.validator');
const svc = require('./ingest.service');
const { enqueue } = require('../../utils/queue');
const AppError = require('../../utils/AppError');

exports.createBatch = async (req, res, next) => {
  try {
    const key = req.get('Idempotency-Key');
    if (!key) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUERIDA', 'Falta el encabezado Idempotency-Key');
    if (key.length > 200) throw new AppError(400, 'IDEMPOTENCY_KEY_INVALIDA', 'Idempotency-Key demasiado largo');

    const existing = await IngestBatch.findOne({ idempotency_key: key });
    if (existing) {
      return res.status(200).json({ batch_id: existing.id, status: existing.status, duplicado: true });
    }

    const { valid, errors } = validateEnvelope(req.body);
    if (!valid) throw new AppError(422, 'LOTE_INVALIDO', 'El lote no cumple el contrato', { errors });

    let batch;
    try {
      batch = await IngestBatch.create({
        source: req.body.source,
        schema_version: req.body.schema_version,
        scraped_at: req.body.scraped_at,
        idempotency_key: key,
        record_count: req.body.records.length,
        records: req.body.records,
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      // Dos envíos simultáneos con la misma llave: gana el primero.
      const first = await IngestBatch.findOne({ idempotency_key: key });
      return res.status(200).json({ batch_id: first.id, status: first.status, duplicado: true });
    }

    await enqueue('ingest', 'process', { batchId: batch.id }, { jobId: `batch-${batch.id}` });
    res.status(202).json({ batch_id: batch.id, status: 'en_cola' });
  } catch (err) {
    next(err);
  }
};

exports.getBatch = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw new AppError(404, 'LOTE_NO_ENCONTRADO', 'Lote no encontrado');
    }
    const found = await svc.getBatch(req.params.id);
    if (!found) throw new AppError(404, 'LOTE_NO_ENCONTRADO', 'Lote no encontrado');
    const { batch, invalidos } = found;
    res.json({
      batch_id: String(batch._id),
      source: batch.source,
      schema_version: batch.schema_version,
      status: batch.status,
      record_count: batch.record_count,
      stats: batch.stats,
      invalidos,
      received_at: batch.created_at,
      processed_at: batch.processed_at || null,
      error: batch.error || null,
    });
  } catch (err) {
    next(err);
  }
};
