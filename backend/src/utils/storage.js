/**
 * Subida de imágenes: a S3 compatible (Cloudflare R2 / DigitalOcean Spaces)
 * si hay S3_BUCKET; si no, a MEDIA_DIR (volumen que Caddy sirve en /media).
 */
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const config = require('../config/env');

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const LOCAL_DIR = config.mediaDir;

let s3 = null;
function client() {
  if (!s3) {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3 = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint || undefined,
      credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
    });
  }
  return s3;
}

/**
 * @param {{buffer:Buffer, mimetype:string}} file
 * @returns {Promise<{url:string, key:string}>}
 */
async function saveImage(file) {
  const key = `products/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${EXT[file.mimetype]}`;
  if (config.s3.bucket) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await client().send(new PutObjectCommand({
      Bucket: config.s3.bucket, Key: key, Body: file.buffer, ContentType: file.mimetype,
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    const base = config.s3.publicUrl || `${config.s3.endpoint}/${config.s3.bucket}`;
    return { url: `${base}/${key}`, key };
  }
  const dest = path.join(LOCAL_DIR, key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, file.buffer);
  return { url: `/media/${key}`, key };
}

module.exports = { saveImage, ALLOWED_TYPES: Object.keys(EXT), LOCAL_DIR };
