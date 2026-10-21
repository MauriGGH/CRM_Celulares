/**
 * CSV (RFC 4180) para la API de exportación. Las celdas que empiezan con
 * = + - @ se prefijan con ' para que Excel no las ejecute como fórmula.
 */
function cell(v) {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {string[]} columns
 * @param {object[]} rows
 */
function toCsv(columns, rows) {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(r[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = { toCsv, cell };
