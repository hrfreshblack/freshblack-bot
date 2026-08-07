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
      is_stock_item BOOLEAN NOT NULL DEFAULT true,
      min_stock NUMERIC NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

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
  `);
}

async function upsertProduct(product) {
  const { rows } = await pool.query(
    `INSERT INTO products (code, name, short_name, unit, is_stock_item, min_stock, active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (code) DO UPDATE SET
       name = excluded.name,
       short_name = excluded.short_name,
       unit = excluded.unit,
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
    `SELECT p.code, p.name, p.short_name, p.unit, p.is_stock_item, p.min_stock, p.active,
            COALESCE(SUM(m.signed_qty), 0) AS balance,
            MAX(m.movement_date) AS last_movement_date
     FROM products p
     LEFT JOIN stock_movements m ON m.product_code = p.code
     ${where}
     GROUP BY p.code, p.name, p.short_name, p.unit, p.is_stock_item, p.min_stock, p.active
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

export default {
  initSchema,
  upsertProduct,
  getProduct,
  getBalance,
  listProducts,
  listMovements,
  addMovement,
  SIGNED_TYPES,
  ABSOLUTE_TYPES
};
