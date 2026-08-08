import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import seedCatalog from './seed-catalog.js';
import seedCatalogAdditions from './seed-catalog-additions.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_USER = process.env.WAREHOUSE_USER || '';
const AUTH_PASSWORD = process.env.WAREHOUSE_PASSWORD || '';

app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Проста Basic Auth — достатньо для внутрішнього інструменту з кількома
// людьми. Якщо змінні не задані, доступ лишається відкритим (зручно для
// першого тестування), але для реального використання обов'язково задати
// WAREHOUSE_USER/WAREHOUSE_PASSWORD в Railway Variables.
app.use((req, res, next) => {
  if (!AUTH_USER || !AUTH_PASSWORD) return next();

  const header = req.get('Authorization') || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    const user = decoded.slice(0, separatorIndex);
    const password = decoded.slice(separatorIndex + 1);

    if (user === AUTH_USER && password === AUTH_PASSWORD) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="FreshBlack Warehouse"');
  res.sendStatus(401);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/products', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const products = await db.listProducts({ search, activeOnly: true });
    res.json({ ok: true, products });
  } catch (error) {
    console.error('GET /api/products ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати список товарів' });
  }
});

app.post('/api/products', async (req, res) => {
  try {
    const { code, name, short_name, unit, station, is_stock_item, min_stock, active } = req.body || {};
    if (!code || !String(code).trim()) {
      res.status(400).json({ ok: false, error: 'Код товару обов’язковий' });
      return;
    }
    const product = await db.upsertProduct({
      code: String(code).trim(),
      name,
      short_name,
      unit,
      station,
      is_stock_item,
      min_stock,
      active
    });
    res.json({ ok: true, product });
  } catch (error) {
    console.error('POST /api/products ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося зберегти товар' });
  }
});

app.get('/api/products/:code/movements', async (req, res) => {
  try {
    const movements = await db.listMovements(req.params.code);
    res.json({ ok: true, movements });
  } catch (error) {
    console.error('GET /api/products/:code/movements ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати історію рухів' });
  }
});

app.post('/api/movements', async (req, res) => {
  try {
    const { product_code, movement_type, qty, note, movement_date, created_by } = req.body || {};

    if (!product_code || !movement_type || qty === undefined || qty === null) {
      res.status(400).json({ ok: false, error: 'Потрібні product_code, movement_type і qty' });
      return;
    }

    const product = await db.getProduct(product_code);
    if (!product) {
      res.status(404).json({ ok: false, error: 'Товар не знайдено в каталозі' });
      return;
    }

    const movement = await db.addMovement({ product_code, movement_type, qty, note, movement_date, created_by });
    const balance = await db.getBalance(product_code);
    res.json({ ok: true, movement, balance });
  } catch (error) {
    console.error('POST /api/movements ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося записати рух' });
  }
});

(async () => {
  try {
    await db.initSchema();

    // Одноразово, лише якщо каталог ще порожній — щоб не затерти те, що
    // вже додано вручну після першого запуску.
    const existing = await db.countProducts();
    if (existing === 0) {
      await db.bulkUpsertProducts(seedCatalog);
      console.log(`Seeded initial catalog: ${seedCatalog.length} products`);
    }

    // Безпечно на кожному старті: додає лише нові коди, ніколи не чіпає
    // те, що вже є (з початкового сідингу чи вручну відредаговане).
    const addedCount = await db.insertProductsIfMissing(seedCatalogAdditions);
    if (addedCount > 0) {
      console.log(`Added ${addedCount} new products found in order history`);
    }
  } catch (error) {
    console.error('Startup DB init ERROR:', error?.stack || error?.message || error);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Warehouse server started on port ${PORT}`);
  });
})();
