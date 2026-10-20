// Se ejecuta UNA sola vez, cuando el volumen de MongoDB está vacío.
// Crea el usuario de la API (readWrite solo en la base de la tienda) y el del
// scraper (readWrite solo en su base "scraping"; nunca toca colecciones de venta).
const env = process.env;
const required = ['APP_DB_NAME', 'APP_DB_USER', 'APP_DB_PASSWORD', 'SCRAPER_DB_NAME', 'SCRAPER_DB_USER', 'SCRAPER_DB_PASSWORD'];
for (const k of required) {
  if (!env[k]) throw new Error(`falta ${k}`);
}

const app = db.getSiblingDB(env.APP_DB_NAME);
app.createUser({
  user: env.APP_DB_USER,
  pwd: env.APP_DB_PASSWORD,
  roles: [{ role: 'readWrite', db: env.APP_DB_NAME }],
});

const scraping = db.getSiblingDB(env.SCRAPER_DB_NAME);
scraping.createUser({
  user: env.SCRAPER_DB_USER,
  pwd: env.SCRAPER_DB_PASSWORD,
  roles: [{ role: 'readWrite', db: env.SCRAPER_DB_NAME }],
});
