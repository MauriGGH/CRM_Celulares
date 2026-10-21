/**
 * Reportes: ventas (por día, marca y canal; más vendidos), inventario
 * valorizado y margen por SKU. Las fechas se agrupan en hora de CDMX.
 */
const Order = require('../orders/order.model');
const inventory = require('../inventory/inventory.service');
const catalog = require('../catalog/catalog.service');
const { toCents, fromCents } = require('../../utils/money');
const { getConfigInt } = require('../../utils/configuracion');

const TZ = 'America/Mexico_City';
const PAGADOS = ['pagado', 'preparando', 'enviado', 'entregado'];
const c = (d) => (d == null ? 0 : toCents(d.toString()));

/** Rango por defecto: últimos 30 días. */
function range({ desde, hasta } = {}) {
  const h = hasta ? new Date(hasta) : new Date();
  const d = desde ? new Date(desde) : new Date(h.getTime() - 30 * 86_400_000);
  return { desde: d, hasta: h };
}

async function sales(q) {
  const { desde, hasta } = range(q);
  const match = { estado: { $in: PAGADOS }, pagado_en: { $gte: desde, $lte: hasta } };
  const [res] = await Order.aggregate([
    { $match: match },
    {
      $facet: {
        resumen: [{ $group: { _id: null, ventas: { $sum: '$total' }, descuentos: { $sum: '$descuento' }, envios: { $sum: '$envio' }, pedidos: { $sum: 1 } } }],
        por_dia: [
          { $group: { _id: { $dateToString: { date: '$pagado_en', format: '%Y-%m-%d', timezone: TZ } }, ventas: { $sum: '$total' }, pedidos: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ],
        por_canal: [{ $group: { _id: '$canal', ventas: { $sum: '$total' }, pedidos: { $sum: 1 } } }],
        por_marca: [
          { $unwind: '$items' },
          { $lookup: { from: 'products', localField: 'items.product_id', foreignField: '_id', as: 'p' } }, // sin pipeline: MongoDB 4.4
          { $group: { _id: { $ifNull: [{ $arrayElemAt: ['$p.brand_nombre', 0] }, 'Sin marca'] }, ventas: { $sum: '$items.subtotal' }, unidades: { $sum: '$items.cantidad' } } },
          { $sort: { ventas: -1 } },
        ],
        mas_vendidos: [
          { $unwind: '$items' },
          { $group: { _id: '$items.sku', nombre: { $first: '$items.nombre' }, unidades: { $sum: '$items.cantidad' }, ventas: { $sum: '$items.subtotal' } } },
          { $sort: { unidades: -1, ventas: -1 } },
          { $limit: 20 },
        ],
      },
    },
  ]);
  const r = res.resumen[0] || { ventas: 0, descuentos: 0, envios: 0, pedidos: 0 };
  const ventas = c(r.ventas);
  return {
    desde, hasta,
    resumen: {
      ventas: fromCents(ventas),
      pedidos: r.pedidos,
      ticket_promedio: fromCents(r.pedidos ? Math.round(ventas / r.pedidos) : 0),
      descuentos: fromCents(c(r.descuentos)),
      envios: fromCents(c(r.envios)),
    },
    por_dia: res.por_dia.map((x) => ({ dia: x._id, ventas: fromCents(c(x.ventas)), pedidos: x.pedidos })),
    por_canal: res.por_canal.map((x) => ({ canal: x._id, ventas: fromCents(c(x.ventas)), pedidos: x.pedidos })),
    por_marca: res.por_marca.map((x) => ({ marca: x._id, ventas: fromCents(c(x.ventas)), unidades: x.unidades })),
    mas_vendidos: res.mas_vendidos.map((x) => ({ sku: x._id, nombre: x.nombre, unidades: x.unidades, ventas: fromCents(c(x.ventas)) })),
  };
}

async function inventoryReport() {
  const umbral = await getConfigInt('stock_bajo_umbral');
  const totals = await inventory.stockTotalsBySku();
  const info = await catalog.findManyBySku(totals.map((t) => t._id));
  let valorCosto = 0;
  let valorVenta = 0;
  const filas = totals.map((t) => {
    const f = info.get(t._id);
    const costo = c(f?.variant.costo);
    const precio = c(f?.variant.precio);
    valorCosto += costo * (t.disponible + t.reservado);
    valorVenta += precio * (t.disponible + t.reservado);
    return {
      sku: t._id,
      nombre: f ? catalog.variantLabel(f.product, f.variant) : t._id,
      disponible: t.disponible,
      reservado: t.reservado,
      costo_unitario: fromCents(costo),
      precio: fromCents(precio),
      valor_costo: fromCents(costo * (t.disponible + t.reservado)),
      stock_bajo: t.disponible <= umbral,
    };
  }).sort((a, b) => a.sku.localeCompare(b.sku));
  return {
    resumen: { skus: filas.length, unidades: filas.reduce((s, x) => s + x.disponible + x.reservado, 0), valor_costo: fromCents(valorCosto), valor_venta: fromCents(valorVenta), umbral_stock_bajo: umbral },
    filas,
  };
}

async function margins(q) {
  const { desde, hasta } = range(q);
  const rows = await Order.aggregate([
    { $match: { estado: { $in: PAGADOS }, pagado_en: { $gte: desde, $lte: hasta } } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.sku',
        nombre: { $first: '$items.nombre' },
        unidades: { $sum: '$items.cantidad' },
        ingreso: { $sum: '$items.subtotal' },
        costo: { $sum: { $multiply: ['$items.costo_unitario', '$items.cantidad'] } },
      },
    },
    { $sort: { ingreso: -1 } },
  ]);
  let ti = 0;
  let tc = 0;
  const filas = rows.map((r) => {
    const ingreso = c(r.ingreso);
    const costo = c(r.costo);
    ti += ingreso; tc += costo;
    return {
      sku: r._id, nombre: r.nombre, unidades: r.unidades,
      ingreso: fromCents(ingreso), costo: fromCents(costo), margen: fromCents(ingreso - costo),
      margen_pct: ingreso ? Math.round(((ingreso - costo) / ingreso) * 1000) / 10 : 0,
    };
  });
  return {
    desde, hasta,
    resumen: { ingreso: fromCents(ti), costo: fromCents(tc), margen: fromCents(ti - tc), margen_pct: ti ? Math.round(((ti - tc) / ti) * 1000) / 10 : 0 },
    filas,
  };
}

// ─── Exportación (portado de mochi-matcha gerente.controller: exceljs + pdfkit) ──

/** Convierte cada reporte en hojas { titulo, columnas, filas }. */
async function sheetsFor(tipo, q) {
  if (tipo === 'sales') {
    const r = await sales(q);
    return {
      titulo: `Ventas ${fmt(r.desde)} a ${fmt(r.hasta)}`,
      resumen: r.resumen,
      hojas: [
        { nombre: 'Por día', columnas: ['dia', 'pedidos', 'ventas'], filas: r.por_dia },
        { nombre: 'Por marca', columnas: ['marca', 'unidades', 'ventas'], filas: r.por_marca },
        { nombre: 'Más vendidos', columnas: ['sku', 'nombre', 'unidades', 'ventas'], filas: r.mas_vendidos },
      ],
    };
  }
  if (tipo === 'inventory') {
    const r = await inventoryReport();
    return {
      titulo: `Inventario al ${fmt(new Date())}`,
      resumen: r.resumen,
      hojas: [{ nombre: 'Inventario', columnas: ['sku', 'nombre', 'disponible', 'reservado', 'costo_unitario', 'precio', 'valor_costo', 'stock_bajo'], filas: r.filas }],
    };
  }
  const r = await margins(q);
  return {
    titulo: `Márgenes ${fmt(r.desde)} a ${fmt(r.hasta)}`,
    resumen: r.resumen,
    hojas: [{ nombre: 'Margen por SKU', columnas: ['sku', 'nombre', 'unidades', 'ingreso', 'costo', 'margen', 'margen_pct'], filas: r.filas }],
  };
}

const fmt = (d) => new Date(d).toLocaleDateString('es-MX', { timeZone: TZ });

async function toXlsx(rep) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Celulares';
  wb.created = new Date();
  const ws = wb.addWorksheet('Resumen');
  ws.columns = [{ width: 32 }, { width: 18 }];
  ws.addRow([rep.titulo]);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.addRow([]);
  for (const [k, v] of Object.entries(rep.resumen)) ws.addRow([k.replace(/_/g, ' '), v]);
  for (const h of rep.hojas) {
    const s = wb.addWorksheet(h.nombre.slice(0, 31));
    s.columns = h.columnas.map((k) => ({ header: k.replace(/_/g, ' '), key: k, width: k === 'nombre' ? 40 : 16 }));
    s.getRow(1).font = { bold: true };
    h.filas.forEach((f) => s.addRow(f));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function toPdf(rep) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  const chunks = [];
  doc.on('data', (b) => chunks.push(b));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.fontSize(16).text('CRM Celulares · Reporte');
  doc.fontSize(10).fillColor('#666').text(rep.titulo).moveDown();
  doc.fillColor('#000').fontSize(11).text('Resumen', { underline: true }).moveDown(0.3).fontSize(9);
  for (const [k, v] of Object.entries(rep.resumen)) doc.text(`• ${k.replace(/_/g, ' ')}: ${v}`);
  for (const h of rep.hojas) {
    doc.moveDown().fontSize(11).text(h.nombre, { underline: true }).moveDown(0.3).fontSize(8);
    h.filas.slice(0, 150).forEach((f) => doc.text(h.columnas.map((k) => f[k]).join('   ')));
    if (h.filas.length > 150) doc.fillColor('#888').text(`… y ${h.filas.length - 150} filas más (descarga Excel).`).fillColor('#000');
  }
  doc.moveDown().fontSize(7).fillColor('#999').text(`Generado el ${new Date().toLocaleString('es-MX', { timeZone: TZ })}`, { align: 'right' });
  doc.end();
  return done;
}

async function exportReport({ tipo, formato, desde, hasta }) {
  const rep = await sheetsFor(tipo, { desde, hasta });
  const stamp = new Date().toISOString().slice(0, 10);
  if (formato === 'xlsx') {
    return { buffer: await toXlsx(rep), filename: `reporte-${tipo}-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  }
  return { buffer: await toPdf(rep), filename: `reporte-${tipo}-${stamp}.pdf`, contentType: 'application/pdf' };
}

module.exports = { sales, inventoryReport, margins, exportReport };
