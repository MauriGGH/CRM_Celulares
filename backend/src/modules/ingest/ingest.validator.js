/**
 * Valida un lote contra docs/contracts/ingest-batch.schema.json (el contrato
 * compartido con el equipo de scrap). Si el contrato cambia, cambia ese archivo,
 * no este.
 */
const path = require('path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const schemaPath = path.resolve(__dirname, '../../../../docs/contracts/ingest-batch.schema.json');
const schema = require(schemaPath);

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

/** @returns {{ valid: boolean, errors: object[] }} */
function validateBatch(body) {
  const valid = validate(body);
  return { valid, errors: valid ? [] : validate.errors };
}

module.exports = { validateBatch, schema };
