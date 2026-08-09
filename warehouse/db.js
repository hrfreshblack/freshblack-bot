import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const { Pool } = pg;

const ACCOUNT_ROLES = ['адмін', 'тімлід', 'станція', 'бухгалтерія'];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Рухи, де qty — це саме кількість, а знак застосовується автоматично.
const SIGNED_TYPES = {
  production_in: 1,
  shipment: -1,
  return: 1,
  writeoff: -1,
  adjustment_plus: 1,
  adjustment_minus: -1
};

// Рухи, де qty — це фактично порахована (абсолютна) кількість, а не дельта.
// Система сама рахує різницю від поточного залишку — так само, як HR рахує
// "порахувала і там 289", а не "додай 289".
const ABSOLUTE_TYPES = new Set(['inventory_baseline', 'inventory_adjustment']);

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      short_name TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      station TEXT NOT NULL DEFAULT '',
      is_stock_item BOOLEAN NOT NULL DEFAULT true,
      min_stock NUMERIC NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      status TEXT NOT NULL DEFAULT 'активний',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS station TEXT NOT NULL DEFAULT '';
    ALTER TABLE products ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'активний';

    CREATE TABLE IF NOT EXISTS stock_movements (
      id SERIAL PRIMARY KEY,
      product_code TEXT NOT NULL REFERENCES products(code),
      movement_type TEXT NOT NULL,
      qty NUMERIC NOT NULL,
      signed_qty NUMERIC NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(product_code);

    CREATE TABLE IF NOT EXISTS blend_recipes (
      id SERIAL PRIMARY KEY,
      category TEXT NOT NULL DEFAULT '',
      blend_name TEXT NOT NULL,
      batch_size NUMERIC NOT NULL DEFAULT 20,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (category, blend_name)
    );

    CREATE TABLE IF NOT EXISTS blend_components (
      id SERIAL PRIMARY KEY,
      recipe_id INTEGER NOT NULL REFERENCES blend_recipes(id) ON DELETE CASCADE,
      component_name TEXT NOT NULL,
      qty NUMERIC NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_blend_components_recipe ON blend_components(recipe_id);

    CREATE TABLE IF NOT EXISTS order_lines (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'SAP',
      order_number TEXT NOT NULL,
      order_date DATE,
      ship_date DATE,
      customer_code TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '',
      branch_name TEXT NOT NULL DEFAULT '',
      product_code TEXT NOT NULL DEFAULT '',
      product_name_raw TEXT NOT NULL DEFAULT '',
      roast_type TEXT NOT NULL DEFAULT '',
      qty NUMERIC NOT NULL DEFAULT 0,
      sap_stock_hint NUMERIC,
      grind_flag TEXT NOT NULL DEFAULT '',
      grind_type TEXT NOT NULL DEFAULT '',
      delivery_method TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'нове',
      status_note TEXT NOT NULL DEFAULT '',
      status_updated_at TIMESTAMPTZ,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (order_number, product_code)
    );
    ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'SAP';
    -- Позначає, що backfillHistoricalShipments уже обробив цей рядок — НАЗАВЖДИ,
    -- незалежно від того, який статус користувач виставить пізніше вручну.
    -- Без цього прапорця backfill орієнтувався на "status != 'відвантажено'",
    -- що збігалося і з "ще не оброблено", і з "вручну скасовано" — тому на
    -- кожному рестарті сервера він повертав ручне скасування назад і додавав
    -- дублікат руху списання.
    ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS historical_backfilled_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_order_lines_order_number ON order_lines(order_number);
    CREATE INDEX IF NOT EXISTS idx_order_lines_status ON order_lines(status);

    CREATE TABLE IF NOT EXISTS clients (
      customer_code TEXT PRIMARY KEY,
      customer_name TEXT NOT NULL DEFAULT '',
      partner_group TEXT NOT NULL DEFAULT '',
      client_type TEXT NOT NULL DEFAULT '',
      manager TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS materials (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      material_type TEXT NOT NULL DEFAULT '',
      size_label TEXT NOT NULL DEFAULT '',
      station TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT 'шт',
      min_stock NUMERIC NOT NULL DEFAULT 0,
      reorder_period_days NUMERIC,
      last_order_date DATE,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (name, size_label)
    );

    CREATE TABLE IF NOT EXISTS material_movements (
      id SERIAL PRIMARY KEY,
      material_id INTEGER NOT NULL REFERENCES materials(id),
      movement_type TEXT NOT NULL,
      qty NUMERIC NOT NULL,
      signed_qty NUMERIC NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_material_movements_material ON material_movements(material_id);

    -- Специфікація пакування товару: яка пачка/плівка/наліпка йде на 1 одиницю
    -- продукту, і в яку коробку пакуємо при відвантаженні. Для ролі
    -- "коробка_відвантаження" qty_per_unit — це частка коробки на 1 одиницю
    -- товару (наприклад 1/20, якщо в коробку влазить 20 шт).
    CREATE TABLE IF NOT EXISTS product_specs (
      id SERIAL PRIMARY KEY,
      product_code TEXT NOT NULL REFERENCES products(code),
      role TEXT NOT NULL,
      material_id INTEGER NOT NULL REFERENCES materials(id),
      qty_per_unit NUMERIC NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (product_code, role)
    );

    -- Форс-мажорна заміна пакування для конкретного рядка замовлення (наприклад
    -- потрібної пачки немає на складі і відвантажують в іншій) — не чіпає
    -- основну специфікацію товару (product_specs), діє тільки на цей рядок.
    CREATE TABLE IF NOT EXISTS order_line_overrides (
      id SERIAL PRIMARY KEY,
      order_line_id INTEGER NOT NULL REFERENCES order_lines(id),
      role TEXT NOT NULL,
      material_id INTEGER NOT NULL REFERENCES materials(id),
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (order_line_id, role)
    );

    -- base_norm/target_norm/unit/employees лишились з першої версії й більше
    -- не пишуться в код — станція може мати кілька операцій із різними
    -- нормами (station_operations) і кількох іменованих співробітників
    -- (station_employees). Колонки не видаляю, щоб не робити руйнівну міграцію.
    CREATE TABLE IF NOT EXISTS stations (
      name TEXT PRIMARY KEY,
      base_norm NUMERIC,
      target_norm NUMERIC,
      unit TEXT NOT NULL DEFAULT '',
      employees TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE stations ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

    -- operation_name = '' означає єдину загальну норму станції. Непорожнє
    -- значення — іменована підоперація (наприклад, у "Збірка дріпів" їх
    -- декілька з різними нормами й одиницями).
    CREATE TABLE IF NOT EXISTS station_operations (
      id SERIAL PRIMARY KEY,
      station TEXT NOT NULL REFERENCES stations(name),
      operation_name TEXT NOT NULL DEFAULT '',
      base_norm NUMERIC,
      target_norm NUMERIC,
      unit TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (station, operation_name)
    );

    CREATE TABLE IF NOT EXISTS station_employees (
      id SERIAL PRIMARY KEY,
      station TEXT NOT NULL REFERENCES stations(name),
      employee_name TEXT NOT NULL,
      personal_norm NUMERIC,
      personal_norm_unit TEXT NOT NULL DEFAULT '',
      schedule_note TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (station, employee_name)
    );

    -- Один обліковий запис на станцію (спільний планшет) або особисто для
    -- адміна/тімліда. role: 'адмін' (весь доступ), 'тімлід' (усе на вкладці
    -- "Станції" для всіх станцій, без каталогу/складу/замовлень/клієнтів),
    -- 'станція' (тільки свої задачі: почати/пауза/завершити, з перемикачем
    -- станції в інтерфейсі — планшет один, а людина може працювати на різних).
    CREATE TABLE IF NOT EXISTS accounts (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      home_station TEXT,
      display_name TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Сесії входу: замінили Basic Auth (браузер кешує його логін/пароль
    -- назавжди, без способу вийти) на кукі-токен зі "ковзним" таймаутом —
    -- кожен запит з валідним токеном подовжує last_seen_at ще на годину;
    -- якщо годину не було жодного запиту, токен більше не проходить.
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES accounts(username),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at);

    CREATE TABLE IF NOT EXISTS production_tasks (
      id SERIAL PRIMARY KEY,
      station TEXT NOT NULL,
      product_code TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      planned_qty NUMERIC NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT '',
      task_date DATE NOT NULL,
      reason TEXT NOT NULL DEFAULT 'ручне',
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'заплановано',
      actual_qty NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_station_date ON production_tasks(station, task_date);
  `);
}

const PRODUCT_STATUSES = ['активний', 'немає в наявності', 'знято з виробництва'];

async function upsertProduct(product) {
  const { rows } = await pool.query(
    `INSERT INTO products (code, name, short_name, unit, station, is_stock_item, min_stock, active, status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (code) DO UPDATE SET
       name = excluded.name,
       short_name = excluded.short_name,
       unit = excluded.unit,
       station = excluded.station,
       is_stock_item = excluded.is_stock_item,
       min_stock = excluded.min_stock,
       active = excluded.active,
       status = excluded.status,
       updated_at = now()
     RETURNING *`,
    [
      product.code,
      product.name || '',
      product.short_name || '',
      product.unit || '',
      product.station || '',
      product.is_stock_item !== false,
      product.min_stock || 0,
      product.active !== false,
      product.status || 'активний'
    ]
  );
  return rows[0];
}

// Часткове оновлення без ризику затерти інші поля (наприклад, зміна лише
// статусу з таблиці не повинна очистити назву чи станцію).
async function updateProductFields(code, { status, station, min_stock, unit, is_stock_item } = {}) {
  const { rows } = await pool.query(
    `UPDATE products SET
       status = COALESCE($2, status),
       station = COALESCE($3, station),
       min_stock = COALESCE($4, min_stock),
       unit = COALESCE($5, unit),
       is_stock_item = COALESCE($6, is_stock_item),
       updated_at = now()
     WHERE code = $1
     RETURNING *`,
    [code, status ?? null, station ?? null, min_stock ?? null, unit ?? null, is_stock_item ?? null]
  );
  return rows[0] || null;
}

async function countMovementsByNote(note) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM stock_movements WHERE note = $1', [note]);
  return rows[0].n;
}

// Одноразовий імпорт "точки нуль" з реальної інвентаризації: ставить
// is_stock_item = true (порахувала фізично — значить це складський товар) і
// записує inventory_adjustment рух на дату підрахунку. Товар, якого ще
// немає в каталозі, спершу додається (insertProductsIfMissing).
async function applyInventoryBaseline(rows, { movement_date, note }) {
  for (const r of rows) {
    await insertProductsIfMissing([{ code: r.code, name: r.name, is_stock_item: true, min_stock: 0 }]);
    await updateProductFields(r.code, { is_stock_item: true });
    await addMovement({ product_code: r.code, movement_type: 'inventory_adjustment', qty: r.qty, movement_date, note });
  }
}

// addMovement для inventory_adjustment рахує signed_qty як "різниця від
// ПОТОЧНОГО залишку" — правильно, коли рухи вносяться в хронологічному
// порядку. Але якщо точку нуль додають ЗАДНІМ ЧИСЛОМ, коли пізніші рухи
// (наприклад відвантаження) вже записані, "поточний залишок" — це вже
// залишок ПІСЛЯ тих пізніших рухів, і формула рахує неправильно. Тут
// ставимо signed_qty = qty напряму, як для першого-в-часі руху товару.
async function insertBackdatedInventoryBaseline(code, qty, movementDate, note) {
  await insertProductsIfMissing([{ code, is_stock_item: true, min_stock: 0 }]);
  await updateProductFields(code, { is_stock_item: true });
  const { rowCount } = await pool.query(
    `INSERT INTO stock_movements (product_code, movement_type, qty, signed_qty, note, movement_date)
     SELECT $1, 'inventory_adjustment', $2, $2, $4, $3
     WHERE NOT EXISTS (SELECT 1 FROM stock_movements WHERE product_code = $1 AND movement_type = 'inventory_adjustment' AND note = $4)`,
    [code, qty, movementDate, note]
  );
  return rowCount;
}

// Лікує вже вставлений задніх числом рух, у якого signed_qty порахувався
// неправильно (див. коментар вище) — приводить signed_qty до qty.
async function fixBackdatedInventoryMovement(code, note) {
  const { rowCount } = await pool.query(
    `UPDATE stock_movements SET signed_qty = qty
     WHERE product_code = $1 AND movement_type = 'inventory_adjustment' AND note = $2 AND signed_qty != qty`,
    [code, note]
  );
  return rowCount;
}

async function getProduct(code) {
  const { rows } = await pool.query('SELECT * FROM products WHERE code = $1', [code]);
  return rows[0] || null;
}

async function countProducts() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM products');
  return rows[0].n;
}

async function getBalance(code) {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(signed_qty), 0) AS balance FROM stock_movements WHERE product_code = $1',
    [code]
  );
  return Number(rows[0].balance);
}

// Список товарів з полічений залишком (сумма рухів). Порожній список рухів
// -> залишок 0, товар усе одно показується.
async function listProducts({ search = '', activeOnly = true } = {}) {
  const conditions = [];
  const params = [];

  if (activeOnly) {
    conditions.push('p.active = true');
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(p.code) LIKE $${params.length} OR lower(p.name) LIKE $${params.length} OR lower(p.short_name) LIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT p.code, p.name, p.short_name, p.unit, p.station, p.is_stock_item, p.min_stock, p.active, p.status,
            COALESCE(SUM(m.signed_qty), 0) AS balance,
            MAX(m.movement_date) AS last_movement_date
     FROM products p
     LEFT JOIN stock_movements m ON m.product_code = p.code
     ${where}
     GROUP BY p.code, p.name, p.short_name, p.unit, p.station, p.is_stock_item, p.min_stock, p.active, p.status
     ORDER BY lower(p.name) ASC`,
    params
  );

  return rows.map((row) => ({
    ...row,
    balance: Number(row.balance),
    min_stock: Number(row.min_stock)
  }));
}

// Операційний вигляд складу — лише товари, що фізично зберігаються (не
// "тільки під замовлення"): залишок, скільки надійшло, скільки видано.
async function listStock({ search = '' } = {}) {
  const conditions = ['p.is_stock_item = true'];
  const params = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(p.code) LIKE $${params.length} OR lower(p.name) LIKE $${params.length} OR lower(p.short_name) LIKE $${params.length})`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const { rows } = await pool.query(
    `SELECT p.code, p.name, p.short_name, p.unit, p.station, p.min_stock, p.status,
            COALESCE(SUM(m.signed_qty), 0) AS balance,
            COALESCE(SUM(CASE WHEN m.movement_type IN ('production_in', 'return') THEN m.qty ELSE 0 END), 0) AS received,
            COALESCE(SUM(CASE WHEN m.movement_type IN ('shipment', 'writeoff') THEN m.qty ELSE 0 END), 0) AS issued,
            MAX(m.movement_date) AS last_movement_date
     FROM products p
     LEFT JOIN stock_movements m ON m.product_code = p.code
     ${where}
     GROUP BY p.code, p.name, p.short_name, p.unit, p.station, p.min_stock, p.status
     ORDER BY lower(p.name) ASC`,
    params
  );

  return rows.map((row) => ({
    ...row,
    balance: Number(row.balance),
    received: Number(row.received),
    issued: Number(row.issued),
    min_stock: Number(row.min_stock)
  }));
}

async function listMovements(code, limit = 50) {
  const { rows } = await pool.query(
    'SELECT * FROM stock_movements WHERE product_code = $1 ORDER BY id DESC LIMIT $2',
    [code, limit]
  );
  return rows;
}

// Дати, коли проводилась інвентаризація (рух типу inventory_adjustment), з
// кількістю порахованих позицій — щоб було видно всі минулі підрахунки.
async function listInventoryDates() {
  const { rows } = await pool.query(
    `SELECT movement_date, count(*)::int AS item_count
     FROM stock_movements WHERE movement_type = 'inventory_adjustment'
     GROUP BY movement_date ORDER BY movement_date DESC`
  );
  return rows;
}

// Деталі одного підрахунку: порахована кількість і розбіжність із тим, що
// система очікувала побачити (signed_qty цього руху — це вже готова різниця,
// бо addMovement для inventory_adjustment рахує її як qty - залишок_до_цього).
async function listInventoryDetail(movementDate) {
  const { rows } = await pool.query(
    `SELECT m.id, m.product_code, p.name, m.qty AS counted_qty, m.signed_qty AS discrepancy, m.note
     FROM stock_movements m
     JOIN products p ON p.code = m.product_code
     WHERE m.movement_type = 'inventory_adjustment' AND m.movement_date = $1
     ORDER BY lower(p.name) ASC`,
    [movementDate]
  );
  return rows.map((r) => ({ ...r, counted_qty: Number(r.counted_qty), discrepancy: Number(r.discrepancy) }));
}

// Порівняння для кожного порахованого товару: залишок на момент першої
// інвентаризації, скільки відвантажено/надійшло з тієї дати і поточний
// розрахунковий залишок — щоб бачити зміну між підрахунками (ТЗ §12).
async function listInventoryComparison() {
  const { rows } = await pool.query(
    `SELECT p.code, p.name,
            first_inv.qty AS baseline_qty, first_inv.movement_date AS baseline_date,
            COALESCE(SUM(CASE WHEN m.movement_date > first_inv.movement_date AND m.movement_type IN ('shipment','writeoff') THEN m.qty ELSE 0 END), 0) AS issued_since,
            COALESCE(SUM(CASE WHEN m.movement_date > first_inv.movement_date AND m.movement_type IN ('production_in','return') THEN m.qty ELSE 0 END), 0) AS received_since,
            COALESCE(SUM(m.signed_qty), 0) AS current_balance
     FROM products p
     JOIN LATERAL (
       SELECT qty, movement_date FROM stock_movements
       WHERE product_code = p.code AND movement_type = 'inventory_adjustment'
       ORDER BY movement_date ASC, id ASC LIMIT 1
     ) first_inv ON true
     LEFT JOIN stock_movements m ON m.product_code = p.code
     GROUP BY p.code, p.name, first_inv.qty, first_inv.movement_date
     ORDER BY lower(p.name) ASC`
  );
  return rows.map((r) => ({
    ...r,
    baseline_qty: Number(r.baseline_qty),
    issued_since: Number(r.issued_since),
    received_since: Number(r.received_since),
    current_balance: Number(r.current_balance)
  }));
}

async function addMovement({ product_code, movement_type, qty, note, movement_date, created_by }) {
  if (!SIGNED_TYPES.hasOwnProperty(movement_type) && !ABSOLUTE_TYPES.has(movement_type)) {
    throw new Error(`Unknown movement_type: ${movement_type}`);
  }

  const numericQty = Number(qty);
  if (!Number.isFinite(numericQty) || numericQty < 0) {
    throw new Error('qty must be a non-negative number');
  }

  let signedQty;
  let storedQty = numericQty;

  if (ABSOLUTE_TYPES.has(movement_type)) {
    const currentBalance = await getBalance(product_code);
    signedQty = numericQty - currentBalance;
  } else {
    signedQty = SIGNED_TYPES[movement_type] * numericQty;
  }

  const { rows } = await pool.query(
    `INSERT INTO stock_movements (product_code, movement_type, qty, signed_qty, note, movement_date, created_by)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6, CURRENT_DATE), $7)
     RETURNING *`,
    [product_code, movement_type, storedQty, signedQty, note || '', movement_date || null, created_by || '']
  );

  return rows[0];
}

async function bulkUpsertProducts(products) {
  for (const product of products) {
    await upsertProduct(product);
  }
}

// На відміну від upsertProduct/bulkUpsertProducts, ЦЕ ніколи нічого не
// перезаписує — якщо код уже є в каталозі (хоч із початкового сідингу, хоч
// уже відредагований вручну через інтерфейс), рядок просто пропускається.
// Тому безпечно викликати щоразу при старті сервера для нових партій
// товарів, знайдених у файлах замовлень — жодного ризику затерти ручні
// правки.
async function insertProductsIfMissing(products) {
  let inserted = 0;
  for (const product of products) {
    const { rowCount } = await pool.query(
      `INSERT INTO products (code, name, short_name, unit, station, is_stock_item, min_stock, active, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
       ON CONFLICT (code) DO NOTHING`,
      [
        product.code,
        product.name || '',
        product.short_name || '',
        product.unit || '',
        product.station || '',
        product.is_stock_item !== false,
        product.min_stock || 0,
        product.active !== false,
        product.status || 'активний'
      ]
    );
    inserted += rowCount;
  }
  return inserted;
}

// Так само, як insertProductsIfMissing — ніколи не перезаписує вже наявний
// рецепт (category+blend_name), тож безпечно викликати щоразу при старті.
async function insertBlendRecipesIfMissing(recipes) {
  let inserted = 0;
  for (const recipe of recipes) {
    const { rows } = await pool.query(
      `INSERT INTO blend_recipes (category, blend_name, batch_size, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (category, blend_name) DO NOTHING
       RETURNING id`,
      [recipe.category || '', recipe.blend_name, recipe.batch_size || 20]
    );
    if (!rows.length) continue;

    const recipeId = rows[0].id;
    inserted += 1;
    for (const component of recipe.components || []) {
      await pool.query(
        `INSERT INTO blend_components (recipe_id, component_name, qty) VALUES ($1,$2,$3)`,
        [recipeId, component.name, component.qty]
      );
    }
  }
  return inserted;
}

async function listBlendRecipes() {
  const { rows } = await pool.query(
    `SELECT r.id, r.category, r.blend_name, r.batch_size,
            c.component_name, c.qty
     FROM blend_recipes r
     LEFT JOIN blend_components c ON c.recipe_id = r.id
     ORDER BY r.category ASC, r.blend_name ASC, c.qty DESC NULLS LAST`,
    []
  );

  const byId = new Map();
  for (const row of rows) {
    if (!byId.has(row.id)) {
      byId.set(row.id, {
        id: row.id,
        category: row.category,
        blend_name: row.blend_name,
        batch_size: Number(row.batch_size),
        components: []
      });
    }
    if (row.component_name) {
      byId.get(row.id).components.push({ name: row.component_name, qty: Number(row.qty) });
    }
  }
  return Array.from(byId.values());
}

const ORDER_STATUSES = ['нове', 'в роботі', 'відвантажено', 'скасовано'];

// Так само, як insertProductsIfMissing — ніколи не перезаписує вже наявного
// клієнта (додано вручну "Групу партнера" чи ні), безпечно на кожен імпорт.
async function insertClientsIfMissing(clients) {
  let inserted = 0;
  for (const client of clients) {
    if (!client.customer_code) continue;
    const { rowCount } = await pool.query(
      `INSERT INTO clients (customer_code, customer_name, updated_at)
       VALUES ($1,$2, now())
       ON CONFLICT (customer_code) DO NOTHING`,
      [client.customer_code, client.customer_name || '']
    );
    inserted += rowCount;
  }
  return inserted;
}

async function listClients({ search = '' } = {}) {
  const conditions = [];
  const params = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(customer_code) LIKE $${params.length} OR lower(customer_name) LIKE $${params.length} OR lower(partner_group) LIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM clients ${where} ORDER BY customer_name ASC`,
    params
  );
  return rows;
}

async function updateClient(customerCode, { partner_group, client_type, manager }) {
  const { rows } = await pool.query(
    `UPDATE clients SET
       partner_group = COALESCE($2, partner_group),
       client_type = COALESCE($3, client_type),
       manager = COALESCE($4, manager),
       updated_at = now()
     WHERE customer_code = $1
     RETURNING *`,
    [customerCode, partner_group ?? null, client_type ?? null, manager ?? null]
  );
  return rows[0] || null;
}

// Клієнти з ручних списків (наприклад вкладка "Капран") не мають коду SAP —
// шукаємо вже наявного клієнта з такою самою назвою (з імпорту замовлень) і
// просто проставляємо менеджера; якщо такого клієнта ще нема, створюємо з
// синтетичним кодом (префікс KAPRAN-), щоб не вигадувати фальшивий SAP-код.
async function upsertClientByName(name, { manager } = {}) {
  const { rows: existing } = await pool.query(
    'SELECT customer_code FROM clients WHERE customer_name = $1 LIMIT 1',
    [name]
  );
  if (existing.length) {
    return updateClient(existing[0].customer_code, { manager });
  }
  const syntheticCode = 'KAPRAN-' + name.replace(/[^a-zA-Zа-яА-ЯіІїЇєЄ0-9]+/g, '_').slice(0, 40);
  await insertClientsIfMissing([{ customer_code: syntheticCode, customer_name: name }]);
  return updateClient(syntheticCode, { manager });
}

// Дедуп по (order_number, product_code) — те саме замовлення, яке з'явилось
// знову в наступному вивантаженні за день (9:00/12:00/15:00), просто
// пропускається. Рядки без номера замовлення чи коду товару не імпортуються
// (це відхилення від ТЗ §10, де рядок без коду теж має потрапляти в план з
// попередженням — поки не реалізовано, бо в реальних SAP-файлах код завжди є).
// Товар і клієнт, яких ще немає в довідниках, додаються автоматично.
async function countOrderLinesBySource(source) {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM order_lines WHERE source = $1', [source]);
  return rows[0].n;
}

async function importOrderLines(lines) {
  let inserted = 0;
  let skippedDuplicate = 0;
  let skippedInvalid = 0;
  let missingDate = 0;
  let newProducts = 0;
  let newClients = 0;

  for (const line of lines) {
    if (!line.ship_date) missingDate += 1;

    if (!line.order_number || !line.product_code) {
      skippedInvalid += 1;
      continue;
    }

    newProducts += await insertProductsIfMissing([{
      code: line.product_code,
      name: line.product_name_raw || '',
      is_stock_item: false,
      min_stock: 0
    }]);

    if (line.customer_code) {
      newClients += await insertClientsIfMissing([{
        customer_code: line.customer_code,
        customer_name: line.customer_name || ''
      }]);
    }

    const { rowCount } = await pool.query(
      `INSERT INTO order_lines (
         source, order_number, order_date, ship_date, customer_code, customer_name, branch_name,
         product_code, product_name_raw, roast_type, qty, sap_stock_hint,
         grind_flag, grind_type, delivery_method
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (order_number, product_code) DO NOTHING`,
      [
        line.source || 'SAP',
        line.order_number,
        line.order_date || null,
        line.ship_date || null,
        line.customer_code || '',
        line.customer_name || '',
        line.branch_name || '',
        line.product_code,
        line.product_name_raw || '',
        line.roast_type || '',
        line.qty || 0,
        line.sap_stock_hint === undefined || line.sap_stock_hint === null || line.sap_stock_hint === '' ? null : line.sap_stock_hint,
        line.grind_flag || '',
        line.grind_type || '',
        line.delivery_method || ''
      ]
    );

    if (rowCount > 0) inserted += 1;
    else skippedDuplicate += 1;
  }

  return { inserted, skippedDuplicate, skippedInvalid, missingDate, newProducts, newClients };
}

// Список замовлень, згрупований по номеру документа. Якщо в межах одного
// замовлення позиції мають різний статус (наприклад частину вже відвантажили
// окремим рухом) — показуємо "змішаний", щоб це впадало в очі.
async function listOrders({ search = '', status = '' } = {}) {
  const conditions = [];
  const params = [];

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(order_number) LIKE $${params.length} OR lower(customer_name) LIKE $${params.length} OR lower(branch_name) LIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT order_number,
            MIN(order_date) AS order_date,
            MIN(ship_date) AS ship_date,
            MAX(customer_code) AS customer_code,
            MAX(customer_name) AS customer_name,
            MAX(branch_name) AS branch_name,
            MAX(delivery_method) AS delivery_method,
            COUNT(*)::int AS line_count,
            SUM(qty) AS total_qty,
            CASE WHEN COUNT(DISTINCT status) = 1 THEN MIN(status) ELSE 'змішаний' END AS status,
            MAX(imported_at) AS imported_at
     FROM order_lines
     ${where}
     GROUP BY order_number
     ORDER BY MIN(ship_date) DESC NULLS LAST, MAX(imported_at) DESC`,
    params
  );
  return rows.map((r) => ({ ...r, total_qty: Number(r.total_qty) }));
}

async function getOrderLines(orderNumber) {
  const { rows } = await pool.query(
    `SELECT ol.*,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'id', olo.id, 'role', olo.role, 'material_id', olo.material_id,
                 'material_name', m.name, 'material_size_label', m.size_label, 'note', olo.note
               ))
               FROM order_line_overrides olo
               JOIN materials m ON m.id = olo.material_id
               WHERE olo.order_line_id = ol.id),
              '[]'
            ) AS overrides
     FROM order_lines ol
     WHERE ol.order_number = $1
     ORDER BY ol.id ASC`,
    [orderNumber]
  );
  return rows;
}

async function upsertOrderLineOverride({ order_line_id, role, material_id, note, created_by }) {
  if (!PRODUCT_SPEC_ROLES.includes(role)) {
    throw new Error(`Unknown role: ${role}`);
  }
  const { rows } = await pool.query(
    `INSERT INTO order_line_overrides (order_line_id, role, material_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (order_line_id, role) DO UPDATE SET
       material_id = excluded.material_id,
       note = excluded.note,
       created_by = excluded.created_by
     RETURNING *`,
    [order_line_id, role, material_id, note || '', created_by || '']
  );
  return rows[0];
}

async function deleteOrderLineOverride(id) {
  const { rowCount } = await pool.query('DELETE FROM order_line_overrides WHERE id = $1', [id]);
  return rowCount;
}

// Перехід у "відвантажено" списує зі складу (рух shipment) кожен рядок, який
// ще не був відвантажений раніше — інакше повторний клік на той самий статус
// списав би вдруге. Перехід з "відвантажено" в інший статус рух не скасовує
// (немає single unambiguous "скасувати відвантаження" — за потреби це окремий
// рух "повернення" вручну).
async function updateOrderStatus(orderNumber, status, note) {
  if (!ORDER_STATUSES.includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }

  const { rows: linesBefore } = await pool.query(
    `SELECT id, product_code, qty, ship_date, status FROM order_lines WHERE order_number = $1`,
    [orderNumber]
  );

  const { rowCount } = await pool.query(
    `UPDATE order_lines SET status = $1, status_note = $2, status_updated_at = now() WHERE order_number = $3`,
    [status, note || '', orderNumber]
  );

  if (status === 'відвантажено') {
    for (const line of linesBefore) {
      if (line.status === 'відвантажено') continue;
      await addMovement({
        product_code: line.product_code,
        movement_type: 'shipment',
        qty: line.qty,
        movement_date: line.ship_date || null,
        note: `Замовлення №${orderNumber}`
      });
    }
  } else {
    // Замовлення виходить зі стану "відвантажено" (скасовано/повернено в
    // роботу) — товар, який уже був списаний, повертається на склад
    // рухом "повернення". Якщо рядок ще не був відвантажений, чіпати нічого.
    for (const line of linesBefore) {
      if (line.status !== 'відвантажено') continue;
      await addMovement({
        product_code: line.product_code,
        movement_type: 'return',
        qty: line.qty,
        movement_date: null,
        note: `Скасування/зміна статусу замовлення №${orderNumber}`
      });
    }
  }

  return rowCount;
}

// Те саме, але для ОДНОГО рядка замовлення — замовлення часто їде не всі
// позиції одразу, тож статус (відвантажено/скасовано) треба вміти міняти
// окремо по кожному товару в замовленні, а не тільки цілим замовленням.
async function updateOrderLineStatus(lineId, status, note) {
  if (!ORDER_STATUSES.includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }

  const { rows } = await pool.query(
    `SELECT id, order_number, product_code, qty, ship_date, status FROM order_lines WHERE id = $1`,
    [lineId]
  );
  const line = rows[0];
  if (!line) return 0;

  const { rowCount } = await pool.query(
    `UPDATE order_lines SET status = $1, status_note = $2, status_updated_at = now() WHERE id = $3`,
    [status, note || '', lineId]
  );

  if (status === 'відвантажено' && line.status !== 'відвантажено') {
    await addMovement({
      product_code: line.product_code,
      movement_type: 'shipment',
      qty: line.qty,
      movement_date: line.ship_date || null,
      note: `Замовлення №${line.order_number}`
    });
  } else if (status !== 'відвантажено' && line.status === 'відвантажено') {
    await addMovement({
      product_code: line.product_code,
      movement_type: 'return',
      qty: line.qty,
      movement_date: null,
      note: `Скасування/зміна статусу замовлення №${line.order_number} (позиція)`
    });
  }

  return rowCount;
}

// Одноразово: історичні замовлення (source='SAP-history') по факту вже
// відвантажені в реальності, тому статус ставимо "відвантажено" для всіх.
// Але рух складу створюємо лише для рядків із датою відвантаження ПІСЛЯ
// точки нуль інвентаризації — те, що відвантажилось до неї, вже враховано
// у порахованому залишку, і повторний рух задвоїв би списання.
// Ідемпотентність — через historical_backfilled_at, а НЕ через поточний
// статус (див. коментар біля колонки): рядок обробляється рівно один раз.
async function backfillHistoricalShipments({ baselineDate }) {
  const { rows: lines } = await pool.query(
    `SELECT id, product_code, qty, ship_date, order_number
     FROM order_lines WHERE source = 'SAP-history' AND historical_backfilled_at IS NULL`
  );

  let movementsCreated = 0;
  let statusOnly = 0;

  for (const line of lines) {
    const shipDateStr = line.ship_date ? line.ship_date.toISOString().slice(0, 10) : null;
    if (shipDateStr && shipDateStr > baselineDate) {
      await addMovement({
        product_code: line.product_code,
        movement_type: 'shipment',
        qty: line.qty,
        movement_date: shipDateStr,
        note: `Замовлення №${line.order_number} (історія)`
      });
      movementsCreated += 1;
    } else {
      statusOnly += 1;
    }
    await pool.query(
      `UPDATE order_lines SET status = 'відвантажено', status_updated_at = now(), historical_backfilled_at = now() WHERE id = $1`,
      [line.id]
    );
  }

  return { movementsCreated, statusOnly };
}

// Одноразова міграція (виконується рівно один раз за весь час існування
// бази — гейт на "чи вже хоч один рядок має historical_backfilled_at"):
// стара версія backfillHistoricalShipments уже пройшлась по ВСІХ
// source='SAP-history' рядках (можливо, кілька разів через баг вище), тож
// на момент додавання нової колонки вони всі фактично вже оброблені.
// Позначаємо їх такими одразу, щоб фікс нижче (cleanupDuplicate...) міг
// безпечно прибрати наслідки багу, а нові майбутні імпорти історичних
// замовлень і далі коректно проходили через реальний backfill.
async function migrateHistoricalBackfillMarker() {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM order_lines WHERE historical_backfilled_at IS NOT NULL`
  );
  if (rows[0].n > 0) return 0;

  const { rowCount } = await pool.query(
    `UPDATE order_lines SET historical_backfilled_at = now() WHERE source = 'SAP-history'`
  );
  return rowCount;
}

// Одноразове (за суттю ідемпотентне) виправлення наслідків багу вище: на
// кожному рестарті сервера backfillHistoricalShipments помилково повторно
// "обробляв" рядки, які Тетяна вручну перевела в "скасовано" (бо їхній
// статус теж підпадав під "status != 'відвантажено'") — це (1) повертало
// статус назад на "відвантажено" і (2) щоразу додавало ще один дублікат
// руху списання/повернення. Тут: спершу лишаємо по одному руху на кожен
// унікальний коментар (дублікати з однаковим product_code+type+note —
// це завжди один і той самий рух, повторений через баг), потім — де рух
// "повернення" (тобто підтверджене ручне скасування) не має ЖОДНОГО
// пізнішого руху відвантаження по цьому самому замовленню — повертаємо
// статус рядка на "скасовано".
async function cleanupDuplicateHistoricalBackfillMovements() {
  const { rowCount: dupesRemoved } = await pool.query(`
    DELETE FROM stock_movements a USING stock_movements b
    WHERE a.id > b.id
      AND a.product_code = b.product_code
      AND a.movement_type = b.movement_type
      AND a.note = b.note
      AND (
        a.note LIKE 'Замовлення №%(історія)'
        OR a.note LIKE 'Скасування/зміна статусу замовлення №%(позиція)'
      )
  `);

  const { rowCount: statusesFixed } = await pool.query(`
    UPDATE order_lines ol
    SET status = 'скасовано',
        status_note = COALESCE(NULLIF(ol.status_note, ''), 'відновлено після виправлення дубльованого списання (авто)'),
        status_updated_at = now()
    WHERE ol.source = 'SAP-history'
      AND ol.status = 'відвантажено'
      AND EXISTS (
        SELECT 1 FROM stock_movements ret
        WHERE ret.product_code = ol.product_code
          AND ret.movement_type = 'return'
          AND ret.note = 'Скасування/зміна статусу замовлення №' || ol.order_number || ' (позиція)'
          AND NOT EXISTS (
            SELECT 1 FROM stock_movements laterShip
            WHERE laterShip.product_code = ol.product_code
              AND laterShip.movement_type = 'shipment'
              AND laterShip.note IN (
                'Замовлення №' || ol.order_number,
                'Замовлення №' || ol.order_number || ' (історія)'
              )
              AND laterShip.created_at > ret.created_at
          )
      )
  `);

  return { dupesRemoved, statusesFixed };
}

// Позиції, які виготовляють під замовлення (ніколи не рахували фізично на
// 02.08 — немає inventory_adjustment) після історичного списання пішли в
// мінус, бо в системі немає записів виробництва за серпень. Тетяна
// підтвердила: для таких позицій вважаємо, що виготовили рівно стільки,
// скільки відвантажили — вирівнюємо до 0 одним рухом "приймання
// виробництва" замість вигаданого числа. Це одноразова історична
// корекція; нові позиції надалі balance-яться реальними задачами/рухами.
async function zeroOutMadeToOrderDeficits(note) {
  const { rows } = await pool.query(
    `SELECT p.code, COALESCE(SUM(m.signed_qty), 0) AS balance
     FROM products p
     LEFT JOIN stock_movements m ON m.product_code = p.code
     WHERE p.code NOT IN (SELECT DISTINCT product_code FROM stock_movements WHERE movement_type = 'inventory_adjustment')
     GROUP BY p.code
     HAVING COALESCE(SUM(m.signed_qty), 0) < 0`
  );

  for (const r of rows) {
    await addMovement({
      product_code: r.code,
      movement_type: 'production_in',
      qty: -Number(r.balance),
      movement_date: null,
      note
    });
  }

  return rows.length;
}

const MATERIAL_SIGNED_TYPES = {
  receipt: 1,
  consumption: -1,
  return: 1,
  writeoff: -1,
  adjustment_plus: 1,
  adjustment_minus: -1
};
const MATERIAL_ABSOLUTE_TYPES = new Set(['inventory_adjustment']);

async function countMaterials() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM materials');
  return rows[0].n;
}

// Одноразово при першому запуску (таблиця ще порожня): створює матеріал і
// одну "інвентаризаційну" подію на його стартову кількість — це точка нуль,
// узята з файлу, який Тетяна скинула станом на серпень 2026.
async function bulkCreateMaterialsWithBaseline(materials) {
  for (const m of materials) {
    const { rows } = await pool.query(
      `INSERT INTO materials (name, material_type, size_label, station, unit)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (name, size_label) DO NOTHING
       RETURNING id`,
      [m.name, m.material_type || '', m.size_label || '', m.station || '', m.unit || 'шт']
    );
    if (!rows.length) continue;
    const materialId = rows[0].id;
    const qty = m.qty_on_hand || 0;
    await pool.query(
      `INSERT INTO material_movements (material_id, movement_type, qty, signed_qty, note, movement_date)
       VALUES ($1, 'inventory_adjustment', $2, $2, 'Початковий залишок (файл від Тетяни)', CURRENT_DATE)`,
      [materialId, qty]
    );
  }
}

async function getMaterialBalance(materialId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(signed_qty), 0) AS balance FROM material_movements WHERE material_id = $1',
    [materialId]
  );
  return Number(rows[0].balance);
}

async function listMaterials({ search = '' } = {}) {
  const conditions = ['m.active = true'];
  const params = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(m.name) LIKE $${params.length} OR lower(m.material_type) LIKE $${params.length} OR lower(m.size_label) LIKE $${params.length})`);
  }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const { rows } = await pool.query(
    `SELECT m.*, COALESCE(SUM(mm.signed_qty), 0) AS balance,
            MAX(mm.movement_date) AS last_movement_date
     FROM materials m
     LEFT JOIN material_movements mm ON mm.material_id = m.id
     ${where}
     GROUP BY m.id
     ORDER BY m.material_type ASC, m.name ASC`,
    params
  );
  return rows.map((r) => ({
    ...r,
    balance: Number(r.balance),
    min_stock: Number(r.min_stock),
    reorder_period_days: r.reorder_period_days === null ? null : Number(r.reorder_period_days)
  }));
}

async function createMaterial(m) {
  const { rows } = await pool.query(
    `INSERT INTO materials (name, material_type, size_label, station, unit, min_stock, reorder_period_days)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [m.name, m.material_type || '', m.size_label || '', m.station || '', m.unit || 'шт', m.min_stock || 0, m.reorder_period_days || null]
  );
  return rows[0];
}

async function updateMaterialFields(id, { station, min_stock, unit, reorder_period_days, material_type } = {}) {
  const { rows } = await pool.query(
    `UPDATE materials SET
       station = COALESCE($2, station),
       min_stock = COALESCE($3, min_stock),
       unit = COALESCE($4, unit),
       reorder_period_days = COALESCE($5, reorder_period_days),
       material_type = COALESCE($6, material_type),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, station ?? null, min_stock ?? null, unit ?? null, reorder_period_days ?? null, material_type ?? null]
  );
  return rows[0] || null;
}

async function listMaterialMovements(materialId, limit = 50) {
  const { rows } = await pool.query(
    'SELECT * FROM material_movements WHERE material_id = $1 ORDER BY id DESC LIMIT $2',
    [materialId, limit]
  );
  return rows;
}

async function addMaterialMovement({ material_id, movement_type, qty, note, movement_date, created_by }) {
  if (!MATERIAL_SIGNED_TYPES.hasOwnProperty(movement_type) && !MATERIAL_ABSOLUTE_TYPES.has(movement_type)) {
    throw new Error(`Unknown movement_type: ${movement_type}`);
  }

  const numericQty = Number(qty);
  if (!Number.isFinite(numericQty) || numericQty < 0) {
    throw new Error('qty must be a non-negative number');
  }

  let signedQty;
  if (MATERIAL_ABSOLUTE_TYPES.has(movement_type)) {
    const currentBalance = await getMaterialBalance(material_id);
    signedQty = numericQty - currentBalance;
  } else {
    signedQty = MATERIAL_SIGNED_TYPES[movement_type] * numericQty;
  }

  const { rows } = await pool.query(
    `INSERT INTO material_movements (material_id, movement_type, qty, signed_qty, note, movement_date, created_by)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6, CURRENT_DATE), $7)
     RETURNING *`,
    [material_id, movement_type, numericQty, signedQty, note || '', movement_date || null, created_by || '']
  );
  return rows[0];
}

const PRODUCT_SPEC_ROLES = ['пачка', 'плівка', 'наліпка_перед', 'наліпка_зад', 'коробка_відвантаження'];

async function listProductSpecs(productCode) {
  const { rows } = await pool.query(
    `SELECT ps.*, m.name AS material_name, m.size_label AS material_size_label, m.unit AS material_unit
     FROM product_specs ps
     JOIN materials m ON m.id = ps.material_id
     WHERE ps.product_code = $1
     ORDER BY ps.role ASC`,
    [productCode]
  );
  return rows.map((r) => ({ ...r, qty_per_unit: Number(r.qty_per_unit) }));
}

async function upsertProductSpec({ product_code, role, material_id, qty_per_unit }) {
  if (!PRODUCT_SPEC_ROLES.includes(role)) {
    throw new Error(`Unknown role: ${role}`);
  }
  const { rows } = await pool.query(
    `INSERT INTO product_specs (product_code, role, material_id, qty_per_unit, updated_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (product_code, role) DO UPDATE SET
       material_id = excluded.material_id,
       qty_per_unit = excluded.qty_per_unit,
       updated_at = now()
     RETURNING *`,
    [product_code, role, material_id, qty_per_unit || 1]
  );
  return rows[0];
}

async function deleteProductSpec(id) {
  const { rowCount } = await pool.query('DELETE FROM product_specs WHERE id = $1', [id]);
  return rowCount;
}

const TASK_STATUSES = ['заплановано', 'виконується', 'пауза', 'завершено', 'заблоковано', 'скасовано'];

// Станції беруться з трьох джерел: реєстр (stations), уже призначені
// товарам/розхідникам і вже використані в задачах — щоб нова довільна назва
// станції, введена вручну, теж з'являлась у списку наступного разу.
async function listStations() {
  const { rows } = await pool.query(
    `SELECT DISTINCT station FROM (
       SELECT name AS station FROM stations WHERE active = true
       UNION
       SELECT station FROM products WHERE station <> ''
       UNION
       SELECT station FROM materials WHERE station <> ''
       UNION
       SELECT station FROM production_tasks WHERE station <> ''
     ) s ORDER BY station ASC`
  );
  return rows.map((r) => r.station);
}

// Безпечно на кожен старт: додає в реєстр лише нові назви станцій, ніколи не
// чіпає вже наявний запис (норми/співробітників, які вручну заповнили).
async function insertStationsIfMissing(names) {
  let inserted = 0;
  for (const name of names) {
    if (!name) continue;
    const { rowCount } = await pool.query(
      `INSERT INTO stations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name]
    );
    inserted += rowCount;
  }
  return inserted;
}

async function updateStation(name, { note } = {}) {
  const { rows } = await pool.query(
    `UPDATE stations SET note = COALESCE($2, note), updated_at = now() WHERE name = $1 RETURNING *`,
    [name, note ?? null]
  );
  return rows[0] || null;
}

// Перейменовує вже наявні значення station у products/materials/tasks на
// канонічну назву (наприклад "ручна" -> "Ручна"), щоб та сама станція не
// показувалась двома картками через різницю в регістрі. Викликається один
// раз при старті з фіксованим списком відомих варіантів написання.
async function normalizeStationNames(aliasMap) {
  for (const [alias, canonical] of Object.entries(aliasMap)) {
    if (alias === canonical) continue;
    await pool.query('UPDATE products SET station = $2 WHERE station = $1', [alias, canonical]);
    await pool.query('UPDATE materials SET station = $2 WHERE station = $1', [alias, canonical]);
    await pool.query('UPDATE production_tasks SET station = $2 WHERE station = $1', [alias, canonical]);
    await pool.query('DELETE FROM stations WHERE name = $1', [alias]);
  }
}

async function upsertStationOperation({ station, operation_name, base_norm, target_norm, unit }) {
  const { rows } = await pool.query(
    `INSERT INTO station_operations (station, operation_name, base_norm, target_norm, unit, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (station, operation_name) DO UPDATE SET
       base_norm = excluded.base_norm,
       target_norm = excluded.target_norm,
       unit = excluded.unit,
       updated_at = now()
     RETURNING *`,
    [station, operation_name || '', base_norm ?? null, target_norm ?? null, unit || '']
  );
  return rows[0];
}

// Безпечно на старт: не чіпає вже наявну (station, operation_name) норму.
async function seedStationOperationsIfMissing(rows) {
  let inserted = 0;
  for (const r of rows) {
    const { rowCount } = await pool.query(
      `INSERT INTO station_operations (station, operation_name, base_norm, target_norm, unit)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (station, operation_name) DO NOTHING`,
      [r.station, r.operation_name || '', r.base_norm ?? null, r.target_norm ?? null, r.unit || '']
    );
    inserted += rowCount;
  }
  return inserted;
}

async function listStationOperations(station) {
  const { rows } = await pool.query(
    'SELECT * FROM station_operations WHERE station = $1 ORDER BY operation_name ASC',
    [station]
  );
  return rows.map((r) => ({ ...r, base_norm: r.base_norm === null ? null : Number(r.base_norm), target_norm: r.target_norm === null ? null : Number(r.target_norm) }));
}

async function upsertStationEmployee({ station, employee_name, personal_norm, personal_norm_unit, schedule_note }) {
  const { rows } = await pool.query(
    `INSERT INTO station_employees (station, employee_name, personal_norm, personal_norm_unit, schedule_note, updated_at)
     VALUES ($1,$2,$3,$4,$5, now())
     ON CONFLICT (station, employee_name) DO UPDATE SET
       personal_norm = excluded.personal_norm,
       personal_norm_unit = excluded.personal_norm_unit,
       schedule_note = excluded.schedule_note,
       updated_at = now()
     RETURNING *`,
    [station, employee_name, personal_norm ?? null, personal_norm_unit || '', schedule_note || '']
  );
  return rows[0];
}

async function seedStationEmployeesIfMissing(rows) {
  let inserted = 0;
  for (const r of rows) {
    const { rowCount } = await pool.query(
      `INSERT INTO station_employees (station, employee_name, personal_norm, personal_norm_unit, schedule_note)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (station, employee_name) DO NOTHING`,
      [r.station, r.employee_name, r.personal_norm ?? null, r.personal_norm_unit || '', r.schedule_note || '']
    );
    inserted += rowCount;
  }
  return inserted;
}

async function listStationEmployees(station) {
  const { rows } = await pool.query(
    'SELECT * FROM station_employees WHERE station = $1 AND active = true ORDER BY employee_name ASC',
    [station]
  );
  return rows.map((r) => ({ ...r, personal_norm: r.personal_norm === null ? null : Number(r.personal_norm) }));
}

// Реєстр станцій з операціями (нормами), співробітниками і поточним станом
// на сьогодні: скільки заплановано, скільки вже фактично виконано, яка
// задача зараз "виконується" (якщо є).
async function listStationsWithStatus() {
  await insertStationsIfMissing(await listStations());

  const { rows: stations } = await pool.query(
    `SELECT s.name, s.note, s.active,
            COALESCE(SUM(CASE WHEN t.task_date = CURRENT_DATE THEN t.planned_qty ELSE 0 END), 0) AS planned_today,
            COALESCE(SUM(CASE WHEN t.task_date = CURRENT_DATE AND t.status = 'завершено' THEN COALESCE(t.actual_qty, t.planned_qty) ELSE 0 END), 0) AS completed_today
     FROM stations s
     LEFT JOIN production_tasks t ON t.station = s.name
     WHERE s.active = true
     GROUP BY s.name, s.note, s.active
     ORDER BY s.name ASC`
  );

  const { rows: activeTasks } = await pool.query(
    `SELECT DISTINCT ON (station) * FROM production_tasks
     WHERE status = 'виконується'
     ORDER BY station, updated_at DESC`
  );
  const activeByStation = new Map(activeTasks.map((t) => [t.station, t]));

  const result = [];
  for (const s of stations) {
    const operations = await listStationOperations(s.name);
    const employees = await listStationEmployees(s.name);
    result.push({
      ...s,
      planned_today: Number(s.planned_today),
      completed_today: Number(s.completed_today),
      active_task: activeByStation.get(s.name) || null,
      operations,
      employees
    });
  }
  return result;
}

async function createTask({ station, product_code, product_name, planned_qty, unit, task_date, reason, comment }) {
  if (!station || !task_date) {
    throw new Error('station і task_date обов’язкові');
  }
  const { rows } = await pool.query(
    `INSERT INTO production_tasks (station, product_code, product_name, planned_qty, unit, task_date, reason, comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      station,
      product_code || '',
      product_name || '',
      planned_qty || 0,
      unit || '',
      task_date,
      reason || 'ручне',
      comment || ''
    ]
  );
  return rows[0];
}

async function listTasks({ station = '', dateFrom = '', dateTo = '', status = '' } = {}) {
  const conditions = [];
  const params = [];

  if (station) {
    params.push(station);
    conditions.push(`station = $${params.length}`);
  }
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`task_date >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`task_date <= $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM production_tasks ${where} ORDER BY task_date ASC, station ASC, id ASC`,
    params
  );
  return rows.map((r) => ({ ...r, planned_qty: Number(r.planned_qty), actual_qty: r.actual_qty === null ? null : Number(r.actual_qty) }));
}

async function updateTaskStatus(id, { status, actual_qty, comment }) {
  if (!TASK_STATUSES.includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }
  const { rows } = await pool.query(
    `UPDATE production_tasks SET
       status = $2,
       actual_qty = COALESCE($3, actual_qty),
       comment = COALESCE($4, comment),
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status, actual_qty ?? null, comment ?? null]
  );
  return rows[0] || null;
}

// Ніколи не перезаписує пароль уже наявного акаунта — безпечно викликати на
// кожен старт з тим самим списком, не скидає пароль, який хтось змінив.
async function createAccountIfMissing({ username, password, role, home_station, display_name }) {
  if (!ACCOUNT_ROLES.includes(role)) {
    throw new Error(`Unknown role: ${role}`);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const { rowCount } = await pool.query(
    `INSERT INTO accounts (username, password_hash, role, home_station, display_name)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (username) DO NOTHING`,
    [username, passwordHash, role, home_station || null, display_name || '']
  );
  return rowCount;
}

// Те саме, що createAccountIfMissing, але приймає вже готовий bcrypt-хеш —
// щоб у сідинг-файлі, який іде в git, ніколи не було відкритого пароля.
async function createAccountIfMissingWithHash({ username, password_hash, role, home_station, display_name }) {
  if (!ACCOUNT_ROLES.includes(role)) {
    throw new Error(`Unknown role: ${role}`);
  }
  const { rowCount } = await pool.query(
    `INSERT INTO accounts (username, password_hash, role, home_station, display_name)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (username) DO NOTHING`,
    [username, password_hash, role, home_station || null, display_name || '']
  );
  return rowCount;
}

async function findAccountByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM accounts WHERE username = $1 AND active = true', [username]);
  return rows[0] || null;
}

async function verifyAccountPassword(account, password) {
  return bcrypt.compare(password, account.password_hash);
}

async function listAccounts() {
  const { rows } = await pool.query(
    'SELECT username, role, home_station, display_name, active, created_at FROM accounts ORDER BY role ASC, username ASC'
  );
  return rows;
}

async function updateAccountPassword(username, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const { rowCount } = await pool.query(
    'UPDATE accounts SET password_hash = $2, updated_at = now() WHERE username = $1',
    [username, passwordHash]
  );
  return rowCount;
}

const SESSION_IDLE_MINUTES = 60;

async function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, username) VALUES ($1, $2)', [token, username]);
  return token;
}

// "Ковзний" таймаут: кожен успішний виклик подовжує last_seen_at ще на
// SESSION_IDLE_MINUTES від поточного моменту. Якщо токен не знайдено або
// з моменту останньої активності минуло більше за таймаут — повертає null,
// сесія вважається завершеною (навіть якщо рядок ще фізично лежить у базі).
async function touchSession(token) {
  const { rows } = await pool.query(
    `UPDATE sessions SET last_seen_at = now()
     WHERE token = $1 AND last_seen_at > now() - interval '${SESSION_IDLE_MINUTES} minutes'
     RETURNING username`,
    [token]
  );
  return rows[0]?.username || null;
}

async function deleteSession(token) {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}

async function cleanupExpiredSessions() {
  const { rowCount } = await pool.query(
    `DELETE FROM sessions WHERE last_seen_at < now() - interval '${SESSION_IDLE_MINUTES} minutes'`
  );
  return rowCount;
}

export default {
  initSchema,
  upsertProduct,
  bulkUpsertProducts,
  insertProductsIfMissing,
  getProduct,
  countProducts,
  getBalance,
  listProducts,
  listMovements,
  listInventoryDates,
  listInventoryDetail,
  listInventoryComparison,
  addMovement,
  insertBlendRecipesIfMissing,
  listBlendRecipes,
  importOrderLines,
  countOrderLinesBySource,
  listOrders,
  getOrderLines,
  upsertOrderLineOverride,
  deleteOrderLineOverride,
  updateOrderStatus,
  updateOrderLineStatus,
  backfillHistoricalShipments,
  migrateHistoricalBackfillMarker,
  cleanupDuplicateHistoricalBackfillMovements,
  zeroOutMadeToOrderDeficits,
  insertClientsIfMissing,
  listClients,
  updateClient,
  upsertClientByName,
  updateProductFields,
  countMovementsByNote,
  applyInventoryBaseline,
  insertBackdatedInventoryBaseline,
  fixBackdatedInventoryMovement,
  listStock,
  listStations,
  createTask,
  listTasks,
  updateTaskStatus,
  insertStationsIfMissing,
  updateStation,
  listStationsWithStatus,
  normalizeStationNames,
  upsertStationOperation,
  seedStationOperationsIfMissing,
  listStationOperations,
  upsertStationEmployee,
  seedStationEmployeesIfMissing,
  listStationEmployees,
  createAccountIfMissing,
  createAccountIfMissingWithHash,
  findAccountByUsername,
  verifyAccountPassword,
  listAccounts,
  updateAccountPassword,
  createSession,
  touchSession,
  deleteSession,
  cleanupExpiredSessions,
  countMaterials,
  bulkCreateMaterialsWithBaseline,
  getMaterialBalance,
  listMaterials,
  createMaterial,
  updateMaterialFields,
  listMaterialMovements,
  addMaterialMovement,
  listProductSpecs,
  upsertProductSpec,
  deleteProductSpec,
  ORDER_STATUSES,
  PRODUCT_STATUSES,
  TASK_STATUSES,
  PRODUCT_SPEC_ROLES,
  MATERIAL_SIGNED_TYPES,
  MATERIAL_ABSOLUTE_TYPES,
  ACCOUNT_ROLES,
  SIGNED_TYPES,
  ABSOLUTE_TYPES
};
