import ExcelJS from 'exceljs';

// Кожен аркуш файлу відповідає одній вкладці Інвентаризацій — розпізнається
// за назвою аркуша (не по порядку, тому вкладки можна перейменовувати
// місцями). Той самий набір, що й "Скачати в Excel", тож найпростіший шлях
// заповнення — скачати поточний стан, вписати "Порахували" і залити файл
// назад тим самим виглядом.
const SECTION_MATCHERS = [
  { section: 'stock', includes: ['склад'] },
  { section: 'materials', includes: ['розхідник'] },
  { section: 'stickers', includes: ['наліпк'] },
  { section: 'green', includes: ['зелен'] },
  { section: 'roasted', includes: ['смажен', 'напівфабрикат'] },
  { section: 'site', includes: ['сайт'] }
];

const COLUMN_MATCHERS = [
  { field: 'code', includes: ['код'] },
  { field: 'name', includes: ['назва', 'найменування'] },
  { field: 'qty', includes: ['порахували', 'кількість'] },
  { field: 'note', includes: ['коментар', 'примітка'] }
];

function matchSection(sheetName) {
  const normalized = String(sheetName || '').trim().toLowerCase();
  for (const { section, includes } of SECTION_MATCHERS) {
    if (includes.some((needle) => normalized.includes(needle))) return section;
  }
  return null;
}

function matchColumn(headerText) {
  const normalized = String(headerText || '').trim().toLowerCase();
  for (const { field, includes } of COLUMN_MATCHERS) {
    if (includes.some((needle) => normalized.includes(needle))) return field;
  }
  return null;
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

// Повертає { sections: { stock: [...], materials: [...], ... }, unmatchedSheets: [...] }.
// Рядок береться в імпорт лише якщо є код або назва І заповнена кількість —
// порожні клітинки "Порахували" (позицію не рахували цього разу) просто
// пропускаються, а не імпортуються як нуль.
export async function parseInventoryFile(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sections = {};
  const unmatchedSheets = [];

  for (const sheet of workbook.worksheets) {
    const section = matchSection(sheet.name);
    if (!section) {
      unmatchedSheets.push(sheet.name);
      continue;
    }

    const headerRow = sheet.getRow(1);
    const columnFields = {};
    headerRow.eachCell((cell, colNumber) => {
      const field = matchColumn(cell.value);
      if (field) columnFields[colNumber] = field;
    });

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const line = {};
      row.eachCell((cell, colNumber) => {
        const field = columnFields[colNumber];
        if (!field) return;
        line[field] = field === 'qty' ? cellNumber(cell.value) : cellText(cell.value);
      });

      if ((line.code || line.name) && line.qty !== undefined && line.qty !== null) {
        rows.push(line);
      }
    });

    sections[section] = (sections[section] || []).concat(rows);
  }

  return { sections, unmatchedSheets };
}
