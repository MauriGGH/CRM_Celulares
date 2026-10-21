/**
 * "Galaxy S25 Ultra" → "galaxy-s25-ultra".
 * @param {string} text
 */
module.exports = function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};
