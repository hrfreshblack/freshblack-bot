import ExcelJS from 'exceljs';

// Заголовки в реальному SAP-файлі можуть бути обрізані шириною колонки, тому
// звіряємо по входженню ключового фрагмента, а не по точному співпадінню.
const HEADER_MATCHERS = [
  { field: 'order_number', includes: ['номер документа', 'номер замовлення'] },
  { field: 'order_date', includes: ['дата замов'] },
  { field: 'ship_date', includes: ['дата відв'] },
  { field: 'customer_code', includes: ['код замовника'] },
  { field: 'customer_name', includes: ['назва замовника'] },
  { field: 'branch_name', includes: ['назва філіал'] },
  { field: 'product_code', includes: ['код товару'] },
  { field: 'product_name_raw', includes: ['назва товару'] },
  { field: 'roast_type', includes: ['вид обсм'] },
  { field: 'qty', includes: ['кількість'] },
  { field: 'sap_stock_hint', includes: ['залишок на складі'] },
  { field: 'grind_flag', includes: ['помел кави'] },
  { field: 'grind_type', includes: ['вид помелу'] },
  { field: 'delivery_method', includes: ['спосіб доставки'] }
];

function matchHeader(headerText) {
  const normalized = String(headerText || '').trim().toLowerCase();
  for (const { field, includes } of HEADER_MATCHERS) {
    if (includes.some((needle) => normalized.includes(needle))) return field;
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  const str = String(value).trim();
  const match = str.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
  if (!match) return null;

  const [, d, m, y] = match;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function cellText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'object' && cell.text !== undefined) return String(cell.text).trim();
  if (typeof cell === 'object' && cell.result !== undefined) return String(cell.result).trim();
  return String(cell).trim();
}

function cellNumber(cell) {
  const text = cellText(cell).replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// Парсить SAP-вивантаження замовлень (перший аркуш, перший рядок — заголовки).
// Повертає масив рядків замовлень, готових для db.importOrderLines.
export async function parseOrderFile(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const columnFields = {};
  headerRow.eachCell((cell, colNumber) => {
    const field = matchHeader(cell.value);
    if (field) columnFields[colNumber] = field;
  });

  const lines = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const line = {};
    row.eachCell((cell, colNumber) => {
      const field = columnFields[colNumber];
      if (!field) return;

      if (field === 'order_date' || field === 'ship_date') {
        line[field] = parseDate(cell.value);
      } else if (field === 'qty' || field === 'sap_stock_hint') {
        line[field] = cellNumber(cell.value);
      } else {
        line[field] = cellText(cell.value);
      }
    });

    if (line.order_number || line.product_code) {
      lines.push(line);
    }
  });

  return lines;
}
