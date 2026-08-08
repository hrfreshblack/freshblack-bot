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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE products ADD COLUMN IF NOT EXISTS station TEXT NOT NULL DEFAULT '';

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
  `);
}

async function upsertProduct(product) {
  const { rows } = await pool.query(
    `INSERT INTO products (code, name, short_name, unit, station, is_stock_item, min_stock, active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (code) DO UPDATE SET
       name = excluded.name,
       short_name = excluded.short_name,
       unit = excluded.unit,
       station = excluded.station,
       is_stock_item = excluded.is_stock_item,
       min_stock = excluded.min_stock,
       active = excluded.active,
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
      product.active !== false
    ]
  );
  return rows[0];
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
    `SELECT p.code, p.name, p.short_name, p.unit, p.station, p.is_stock_item, p.min_stock, p.active,
            COALESCE(SUM(m.signed_qty), 0) AS balance,
            MAX(m.movement_date) AS last_movement_date
     FROM products p
     LEFT JOIN stock_movements m ON m.product_code = p.code
     ${where}
     GROUP BY p.code, p.name, p.short_name, p.unit, p.station, p.is_stock_item, p.min_stock, p.active
     ORDER BY p.name ASC`,
    params
  );

  return rows.map((row) => ({
    ...row,
    balance: Number(row.balance),
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
      `INSERT INTO products (code, name, short_name, unit, station, is_stock_item, min_stock, active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
       ON CONFLICT (code) DO NOTHING`,
      [
        product.code,
        product.name || '',
        product.short_name || '',
        product.unit || '',
        product.station || '',
        product.is_stock_item !== false,
        product.min_stock || 0,
        product.active !== false
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
  SIGNED_TYPES,
  ABSOLUTE_TYPES
};
