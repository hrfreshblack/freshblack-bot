import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import db from './db.js';
import seedCatalog from './seed-catalog.js';
import seedCatalogAdditions from './seed-catalog-additions.js';
import seedBlendRecipes from './seed-blend-recipes.js';
import seedMaterials from './seed-materials.js';
import { parseOrderFile } from './parse-order-file.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

const AUTH_USER = process.env.WAREHOUSE_USER || '';
const AUTH_PASSWORD = process.env.WAREHOUSE_PASSWORD || '';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

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
    const { code, name, short_name, unit, station, is_stock_item, min_stock, active, status } = req.body || {};
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
      active,
      status
    });
    res.json({ ok: true, product });
  } catch (error) {
    console.error('POST /api/products ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося зберегти товар' });
  }
});

app.post('/api/products/:code', async (req, res) => {
  try {
    const { status, station, min_stock, unit } = req.body || {};
    const product = await db.updateProductFields(req.params.code, { status, station, min_stock, unit });
    if (!product) {
      res.status(404).json({ ok: false, error: 'Товар не знайдено' });
      return;
    }
    res.json({ ok: true, product });
  } catch (error) {
    console.error('POST /api/products/:code ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити товар' });
  }
});

app.get('/api/stock', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const stock = await db.listStock({ search });
    res.json({ ok: true, stock });
  } catch (error) {
    console.error('GET /api/stock ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати склад' });
  }
});

app.get('/api/stations', async (req, res) => {
  try {
    const stations = await db.listStations();
    res.json({ ok: true, stations });
  } catch (error) {
    console.error('GET /api/stations ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати список станцій' });
  }
});

app.get('/api/stations-status', async (req, res) => {
  try {
    const stations = await db.listStationsWithStatus();
    res.json({ ok: true, stations });
  } catch (error) {
    console.error('GET /api/stations-status ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати стан станцій' });
  }
});

app.post('/api/stations/:name', async (req, res) => {
  try {
    const { base_norm, target_norm, unit, employees } = req.body || {};
    const station = await db.updateStation(req.params.name, { base_norm, target_norm, unit, employees });
    if (!station) {
      res.status(404).json({ ok: false, error: 'Станцію не знайдено' });
      return;
    }
    res.json({ ok: true, station });
  } catch (error) {
    console.error('POST /api/stations/:name ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити станцію' });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { station, product_code, product_name, planned_qty, unit, task_date, reason, comment } = req.body || {};
    if (!station || !task_date) {
      res.status(400).json({ ok: false, error: 'Станція і дата обов’язкові' });
      return;
    }
    const task = await db.createTask({ station, product_code, product_name, planned_qty, unit, task_date, reason, comment });
    res.json({ ok: true, task });
  } catch (error) {
    console.error('POST /api/tasks ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити задачу' });
  }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const { station = '', dateFrom = '', dateTo = '', status = '' } = req.query;
    const tasks = await db.listTasks({ station, dateFrom, dateTo, status });
    res.json({ ok: true, tasks });
  } catch (error) {
    console.error('GET /api/tasks ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати задачі' });
  }
});

app.post('/api/tasks/:id/status', async (req, res) => {
  try {
    const { status, actual_qty, comment } = req.body || {};
    if (!db.TASK_STATUSES.includes(status)) {
      res.status(400).json({ ok: false, error: 'Невідомий статус' });
      return;
    }
    const task = await db.updateTaskStatus(Number(req.params.id), { status, actual_qty, comment });
    if (!task) {
      res.status(404).json({ ok: false, error: 'Задачу не знайдено' });
      return;
    }
    res.json({ ok: true, task });
  } catch (error) {
    console.error('POST /api/tasks/:id/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

app.get('/api/materials', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const materials = await db.listMaterials({ search });
    res.json({ ok: true, materials });
  } catch (error) {
    console.error('GET /api/materials ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати розхідники' });
  }
});

app.post('/api/materials', async (req, res) => {
  try {
    const { name, material_type, size_label, station, unit, min_stock, reorder_period_days } = req.body || {};
    if (!name || !String(name).trim()) {
      res.status(400).json({ ok: false, error: 'Назва обов’язкова' });
      return;
    }
    const material = await db.createMaterial({ name: String(name).trim(), material_type, size_label, station, unit, min_stock, reorder_period_days });
    res.json({ ok: true, material });
  } catch (error) {
    console.error('POST /api/materials ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити матеріал' });
  }
});

app.post('/api/materials/:id', async (req, res) => {
  try {
    const { station, min_stock, unit, reorder_period_days, material_type } = req.body || {};
    const material = await db.updateMaterialFields(Number(req.params.id), { station, min_stock, unit, reorder_period_days, material_type });
    if (!material) {
      res.status(404).json({ ok: false, error: 'Матеріал не знайдено' });
      return;
    }
    res.json({ ok: true, material });
  } catch (error) {
    console.error('POST /api/materials/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити матеріал' });
  }
});

app.get('/api/materials/:id/movements', async (req, res) => {
  try {
    const movements = await db.listMaterialMovements(Number(req.params.id));
    res.json({ ok: true, movements });
  } catch (error) {
    console.error('GET /api/materials/:id/movements ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати історію рухів' });
  }
});

app.post('/api/material-movements', async (req, res) => {
  try {
    const { material_id, movement_type, qty, note, movement_date, created_by } = req.body || {};
    if (!material_id || !movement_type || qty === undefined || qty === null) {
      res.status(400).json({ ok: false, error: 'Потрібні material_id, movement_type і qty' });
      return;
    }
    const movement = await db.addMaterialMovement({ material_id, movement_type, qty, note, movement_date, created_by });
    const balance = await db.getMaterialBalance(material_id);
    res.json({ ok: true, movement, balance });
  } catch (error) {
    console.error('POST /api/material-movements ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося записати рух' });
  }
});

app.get('/api/products/:code/specs', async (req, res) => {
  try {
    const specs = await db.listProductSpecs(req.params.code);
    res.json({ ok: true, specs });
  } catch (error) {
    console.error('GET /api/products/:code/specs ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати специфікацію' });
  }
});

app.post('/api/products/:code/specs', async (req, res) => {
  try {
    const { role, material_id, qty_per_unit } = req.body || {};
    if (!role || !material_id) {
      res.status(400).json({ ok: false, error: 'Потрібні role і material_id' });
      return;
    }
    const spec = await db.upsertProductSpec({ product_code: req.params.code, role, material_id, qty_per_unit });
    res.json({ ok: true, spec });
  } catch (error) {
    console.error('POST /api/products/:code/specs ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти специфікацію' });
  }
});

app.delete('/api/product-specs/:id', async (req, res) => {
  try {
    const rowCount = await db.deleteProductSpec(Number(req.params.id));
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/product-specs/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося видалити' });
  }
});

app.get('/api/blend-recipes', async (req, res) => {
  try {
    const recipes = await db.listBlendRecipes();
    res.json({ ok: true, recipes });
  } catch (error) {
    console.error('GET /api/blend-recipes ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати рецептури' });
  }
});

app.post('/api/orders/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ ok: false, error: 'Файл не додано' });
      return;
    }
    const lines = await parseOrderFile(req.file.buffer);
    const result = await db.importOrderLines(lines);
    res.json({ ok: true, ...result, totalRows: lines.length });
  } catch (error) {
    console.error('POST /api/orders/import ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося розпізнати файл' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const orders = await db.listOrders({ search, status });
    res.json({ ok: true, orders });
  } catch (error) {
    console.error('GET /api/orders ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати список замовлень' });
  }
});

app.get('/api/orders/:orderNumber', async (req, res) => {
  try {
    const lines = await db.getOrderLines(req.params.orderNumber);
    res.json({ ok: true, lines });
  } catch (error) {
    console.error('GET /api/orders/:orderNumber ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати замовлення' });
  }
});

app.post('/api/orders/:orderNumber/status', async (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!db.ORDER_STATUSES.includes(status)) {
      res.status(400).json({ ok: false, error: 'Невідомий статус' });
      return;
    }
    const rowCount = await db.updateOrderStatus(req.params.orderNumber, status, note);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Замовлення не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/orders/:orderNumber/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

app.get('/api/clients', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const clients = await db.listClients({ search });
    res.json({ ok: true, clients });
  } catch (error) {
    console.error('GET /api/clients ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати список клієнтів' });
  }
});

app.post('/api/clients/:customerCode', async (req, res) => {
  try {
    const { partner_group, client_type, manager } = req.body || {};
    const client = await db.updateClient(req.params.customerCode, { partner_group, client_type, manager });
    if (!client) {
      res.status(404).json({ ok: false, error: 'Клієнта не знайдено' });
      return;
    }
    res.json({ ok: true, client });
  } catch (error) {
    console.error('POST /api/clients/:customerCode ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти клієнта' });
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

    const addedRecipes = await db.insertBlendRecipesIfMissing(seedBlendRecipes);
    if (addedRecipes > 0) {
      console.log(`Added ${addedRecipes} blend recipes`);
    }

    const existingMaterials = await db.countMaterials();
    if (existingMaterials === 0) {
      await db.bulkCreateMaterialsWithBaseline(seedMaterials);
      console.log(`Seeded initial materials catalog: ${seedMaterials.length} materials`);
    }
  } catch (error) {
    console.error('Startup DB init ERROR:', error?.stack || error?.message || error);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Warehouse server started on port ${PORT}`);
  });
})();
