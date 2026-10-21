/**
 * Similitud por trigramas (mismo criterio que pg_trgm): conjunto de
 * trigramas de cada palabra con relleno, similitud = |A ∩ B| / |A ∪ B|.
 * Se usa como respaldo en el empate de ingesta cuando no hay gtin ni
 * match_key exacto.
 */
function trigrams(text) {
  const set = new Set();
  for (const w of String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean)) {
    const p = `  ${w} `;
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3));
  }
  return set;
}

/** @returns {number} 0 a 1 */
function similarity(a, b) {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

module.exports = { similarity, trigrams };
