import ExcelJS from 'exceljs';

// Один аркуш на вкладку інвентаризації (Склад/Розхідники/Наліпки/Зелена
// кава/Смажена кава/Позиції з сайту) — та сама структура колонок, що й на
// екрані "Деталі підрахунку", щоб файл читався так само зрозуміло.
const SECTION_LABELS = {
  stock: 'Склад',
  materials: 'Розхідники',
  stickers: 'Наліпки',
  green: 'Зелена кава',
  roasted: 'Смажена кава',
  site: 'Позиції з сайту'
};

export async function buildInventoryWorkbook(sectionsData) {
  const workbook = new ExcelJS.Workbook();
  for (const [section, rows] of Object.entries(sectionsData)) {
    const sheet = workbook.addWorksheet(SECTION_LABELS[section] || section);
    sheet.columns = [
      { header: 'Код', key: 'code', width: 16 },
      { header: 'Назва', key: 'name', width: 44 },
      { header: 'Порахували', key: 'counted_qty', width: 14 },
      { header: 'Розбіжність', key: 'discrepancy', width: 14 },
      { header: 'Коментар', key: 'note', width: 44 }
    ];
    sheet.getRow(1).font = { bold: true };
    rows.forEach((r) => sheet.addRow({
      code: r.code,
      name: r.name,
      counted_qty: r.counted_qty,
      discrepancy: r.discrepancy,
      note: r.note || ''
    }));
    if (!rows.length) sheet.addRow({ code: '', name: 'Порожньо — по цій вкладці нічого не порахували цього дня', counted_qty: '', discrepancy: '', note: '' });
  }
  return workbook.xlsx.writeBuffer();
}
