import pg from 'pg';

const { Pool } = pg;

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
async function updateProductFields(code, { status, station, min_stock, unit } = {}) {
  const { rows } = await pool.query(
    `UPDATE products SET
       status = COALESCE($2, status),
       station = COALESCE($3, station),
       min_stock = COALESCE($4, min_stock),
       unit = COALESCE($5, unit),
       updated_at = now()
     WHERE code = $1
     RETURNING *`,
    [code, status ?? null, station ?? null, min_stock ?? null, unit ?? null]
  );
  return rows[0] || null;
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
     ORDER BY p.name ASC`,
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
     ORDER BY p.name ASC`,
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

// Дедуп по (order_number, product_code) — те саме замовлення, яке з'явилось
// знову в наступному вивантаженні за день (9:00/12:00/15:00), просто
// пропускається. Рядки без номера замовлення чи коду товару не імпортуються
// (це відхилення від ТЗ §10, де рядок без коду теж має потрапляти в план з
// попередженням — поки не реалізовано, бо в реальних SAP-файлах код завжди є).
// Товар і клієнт, яких ще немає в довідниках, додаються автоматично.
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
         order_number, order_date, ship_date, customer_code, customer_name, branch_name,
         product_code, product_name_raw, roast_type, qty, sap_stock_hint,
         grind_flag, grind_type, delivery_method
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (order_number, product_code) DO NOTHING`,
      [
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
     ORDER BY MAX(imported_at) DESC`,
    params
  );
  return rows.map((r) => ({ ...r, total_qty: Number(r.total_qty) }));
}

async function getOrderLines(orderNumber) {
  const { rows } = await pool.query(
    'SELECT * FROM order_lines WHERE order_number = $1 ORDER BY id ASC',
    [orderNumber]
  );
  return rows;
}

async function updateOrderStatus(orderNumber, status, note) {
  if (!ORDER_STATUSES.includes(status)) {
    throw new Error(`Unknown status: ${status}`);
  }
  const { rowCount } = await pool.query(
    `UPDATE order_lines SET status = $1, status_note = $2, status_updated_at = now() WHERE order_number = $3`,
    [status, note || '', orderNumber]
  );
  return rowCount;
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

// Станції беруться з двох джерел: уже призначені товарам (каталог) і вже
// використані в задачах — щоб нова довільна назва станції, введена вручну
// при створенні задачі, теж з'являлась у списку наступного разу.
async function listStations() {
  const { rows } = await pool.query(
    `SELECT DISTINCT station FROM (
       SELECT station FROM products WHERE station <> ''
       UNION
       SELECT station FROM production_tasks WHERE station <> ''
     ) s ORDER BY station ASC`
  );
  return rows.map((r) => r.station);
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
  addMovement,
  insertBlendRecipesIfMissing,
  listBlendRecipes,
  importOrderLines,
  listOrders,
  getOrderLines,
  updateOrderStatus,
  insertClientsIfMissing,
  listClients,
  updateClient,
  updateProductFields,
  listStock,
  listStations,
  createTask,
  listTasks,
  updateTaskStatus,
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
  SIGNED_TYPES,
  ABSOLUTE_TYPES
};
