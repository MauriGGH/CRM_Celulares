/**
 * Valida lotes contra el contrato v1.0 compartido con el equipo de scrap
 * (docs/contracts/ingest-batch.schema.json). La copia en ./contracts va
 * dentro de la imagen Docker; un test verifica que sea idéntica a docs/.
 *
 * - validateEnvelope: sobre, versión y tamaño del lote (síncrono, 422 si falla).
 * - validateRecord: cada registro por separado en el worker; uno inválido no
 *   tira el lote completo, queda como `invalido` con su motivo.
 */
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const schema = require('./contracts/ingest-batch.schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const envelopeSchema = {
  ...schema,
  $id: `${schema.$id.replace(/\.json$/, '')}-envelope.json`,
  properties: { ...schema.properties, records: { ...schema.properties.records, items: { type: 'object' } } },
};
// El registro se valida con la misma definición a la que apunta `records.items`.
const recordSchema = {
  $schema: schema.$schema,
  $id: `${schema.$id.replace(/\.json$/, '')}-record.json`,
  $defs: schema.$defs,
  $ref: schema.properties.records.items.$ref,
};

const envelope = ajv.compile(envelopeSchema);
const record = ajv.compile(recordSchema);

/** @returns {{ valid: boolean, errors: object[] }} */
function validateEnvelope(body) {
  const valid = envelope(body);
  return { valid, errors: valid ? [] : envelope.errors };
}

/** @returns {{ valid: boolean, motivo: string|null }} */
function validateRecord(rec) {
  const valid = record(rec);
  if (valid) return { valid, motivo: null };
  const motivo = record.errors
    .map((e) => `${e.instancePath || '(registro)'} ${e.message}${e.params?.additionalProperty ? ` (${e.params.additionalProperty})` : ''}`.trim())
    .join('; ');
  return { valid, motivo };
}

module.exports = { validateEnvelope, validateRecord, schema };
