/**
 * Endpoints internos de ingesta (los consume solo el scraper).
 *
 * POST /internal/v1/ingest/batches  → valida el contrato, guarda el lote y responde 202.
 * GET  /internal/v1/ingest/batches/:id → estado y conteos del lote.
 *
 * El procesamiento (empate con variantes, competitor_prices, cola de revisión)
 * es la tarea B12 y vive en src/jobs/ingest.job.js.
 */
const mongoose = require('mongoose');
const IngestBatch = require('./ingest-batch.model');
const { validateBatch } = require('./ingest.validator');
const AppError = require('../../utils/AppError');

exports.createBatch = async (req, res, next) => {
  try {
    const key = req.get('Idempotency-Key');
    if (!key) throw new AppError(400, 'IDEMPOTENCY_KEY_REQUERIDA', 'Falta el encabezado Idempotency-Key');

    const existing = await IngestBatch.findOne({ idempotency_key: key });
    if (existing) {
      return res.status(200).json({ batch_id: existing.id, status: existing.status, duplicado: true });
    }

    const { valid, errors } = validateBatch(req.body);
    if (!valid) throw new AppError(422, 'LOTE_INVALIDO', 'El lote no cumple el contrato', { errors });

    const batch = await IngestBatch.create({
      source: req.body.source,
      schema_version: req.body.schema_version,
      scraped_at: req.body.scraped_at,
      idempotency_key: key,
      record_count: req.body.records.length,
      records: req.body.records,
    });

    // TODO(backend B12): encolar el lote en BullMQ → queue('ingest').add('process', { batchId })
    res.status(202).json({ batch_id: batch.id, status: batch.status });
  } catch (err) {
    next(err);
  }
};

exports.getBatch = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw new AppError(404, 'LOTE_NO_ENCONTRADO', 'Lote no encontrado');
    }
    const batch = await IngestBatch.findById(req.params.id);
    if (!batch) throw new AppError(404, 'LOTE_NO_ENCONTRADO', 'Lote no encontrado');
    res.json({
      batch_id: batch.id,
      source: batch.source,
      status: batch.status,
      record_count: batch.record_count,
      stats: batch.stats,
      error: batch.error || null,
    });
  } catch (err) {
    next(err);
  }
};
