import ExcelJS from 'exceljs';

// Масовий імпорт співробітників з файлу — один аркуш, заголовки в першому
// рядку, порядок колонок довільний (розпізнається за текстом заголовка,
// не за позицією).
const HEADER_MATCHERS = [
  { field: 'full_name', includes: ['піб', "прізвище"] },
  { field: 'first_hire_date', includes: ['дата початку', 'дата прийом', 'початок роботи'] },
  { field: 'employed_under', includes: ['оформлен', 'юридичн', 'фоп'] },
  { field: 'birth_date', includes: ['день народж', 'дата народж'] },
  { field: 'corporate_email', includes: ['робоча пошта', 'робочий email', 'corporate', 'пошта'] },
  { field: 'phone', includes: ['телефон'] },
  { field: 'telegram', includes: ['телеграм', 'telegram'] }
];

function matchHeader(headerText) {
  const normalized = String(headerText || '').trim().toLowerCase();
  for (const { field, includes } of HEADER_MATCHERS) {
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

export async function parseEmployeesFile(buffer) {
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

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const line = {};
    row.eachCell((cell, colNumber) => {
      const field = columnFields[colNumber];
      if (!field) return;
      line[field] = field === 'first_hire_date' || field === 'birth_date' ? parseDate(cell.value) : cellText(cell.value);
    });

    if (line.full_name) rows.push(line);
  });

  return rows;
}
