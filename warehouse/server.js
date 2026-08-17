import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import db from './db.js';
import { signSsoToken, verifySsoToken } from './sso.js';
import seedCatalog from './seed-catalog.js';
import seedCatalogAdditions from './seed-catalog-additions.js';
import seedFinishedProductsSap from './seed-finished-products-sap.js';
import seedBlendRecipes from './seed-blend-recipes.js';
import seedMaterials from './seed-materials.js';
import seedMaterialsSap from './seed-materials-sap.js';
import seedStickers from './seed-stickers.js';
import seedAccounts from './seed-accounts.js';
import seedInventoryAug2 from './seed-inventory-aug2.js';
import seedKapranClients from './seed-kapran-clients.js';
import seedGreenCoffee from './seed-green-coffee.js';
import seedGreenCoffeeSap from './seed-green-coffee-sap.js';
import { STATION_NAME_ALIASES, stationNotes, stationOperations, stationEmployees } from './seed-stations.js';
import { parseOrderFile } from './parse-order-file.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// Кукі-сесія зі "ковзним" таймаутом замість Basic Auth. Basic Auth браузер
// кешує назавжди (поки вкладку/браузер не закрити) — не було способу
// вийти, і "якщо годину нічого не робили — вихід" неможливо було зробити
// в принципі. Токен у httpOnly-кукі + рядок у таблиці sessions;
// db.touchSession() на кожен запит подовжує термін дії ще на годину від
// поточного моменту, і так само подовжується Max-Age самої кукі нижче.
const SESSION_COOKIE = 'fb_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60;

function parseCookies(req) {
  const header = req.get('Cookie') || '';
  const cookies = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    if (key) cookies[key] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  res.append('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

async function authMiddleware(req, res, next) {
  const token = parseCookies(req)[SESSION_COOKIE];

  if (token) {
    try {
      const username = await db.touchSession(token);
      if (username) {
        const account = await db.findAccountByUsername(username);
        if (account) {
          req.account = account;
          setSessionCookie(res, token); // подовжуємо й кукі в браузері, не лише запис у базі
          return next();
        }
      }
    } catch (error) {
      console.error('Auth ERROR:', error?.message || error);
    }
  }

  res.status(401).json({ ok: false, error: 'Сесія завершена, увійдіть знову' });
}

// адмін завжди проходить. Якщо перелік ролей порожній — це адмін-only маршрут.
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.account.role === 'адмін' || roles.includes(req.account.role)) return next();
    res.status(403).json({ ok: false, error: 'Немає доступу' });
  };
}

// Статика (сторінка, стилі, JS) віддається без авторизації — інакше
// сторінка входу сама не змогла б завантажитись. Дані йдуть лише через
// /api/*, який вже за authMiddleware нижче.
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ ok: false, error: 'Потрібні логін і пароль' });
      return;
    }
    const account = await db.findAccountByUsername(username);
    if (!account || !(await db.verifyAccountPassword(account, password))) {
      res.status(401).json({ ok: false, error: 'Невірний логін або пароль' });
      return;
    }
    const token = await db.createSession(account.username);
    setSessionCookie(res, token);
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/login ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося увійти' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await db.deleteSession(token);
  } catch (error) {
    console.error('POST /api/logout ERROR:', error?.message || error);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Прийом переходу з іншого застосунку Fresh Black Workspace (HR CRM) —
// публічний маршрут (до authMiddleware), бо на цьому етапі своєї сесії
// ще нема. Токен підтверджує лише "цю людину щойно пропустила інша наша
// система" — заводить сесію тут, ЛИШЕ якщо в цьому застосунку вже є
// акаунт із таким самим username (нікого не створює й не підвищує права).
app.get('/sso', async (req, res) => {
  try {
    const token = String(req.query.token || '');
    const username = token ? verifySsoToken(token) : null;
    if (username) {
      const account = await db.findAccountByUsername(username);
      if (account) {
        const sessionToken = await db.createSession(account.username);
        setSessionCookie(res, sessionToken);
      }
    }
  } catch (error) {
    console.error('GET /sso ERROR:', error?.message || error);
  }
  res.redirect('/');
});

app.use(authMiddleware);

app.get('/api/sso-token', (req, res) => {
  try {
    const token = signSsoToken(req.account.username);
    res.json({ ok: true, token });
  } catch (error) {
    console.error('GET /api/sso-token ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'SSO не налаштовано' });
  }
});

app.get('/api/me', (req, res) => {
  const { username, role, home_station, display_name } = req.account;
  res.json({ ok: true, account: { username, role, home_station, display_name } });
});

app.get('/api/products', requireRole('тімлід'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const products = await db.listProducts({ search, activeOnly: true });
    res.json({ ok: true, products });
  } catch (error) {
    console.error('GET /api/products ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати список товарів' });
  }
});

app.post('/api/products', requireRole(), async (req, res) => {
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

app.post('/api/products/:code', requireRole(), async (req, res) => {
  try {
    const { status, station, min_stock, unit, is_stock_item } = req.body || {};
    const product = await db.updateProductFields(req.params.code, { status, station, min_stock, unit, is_stock_item });
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

app.get('/api/stock', requireRole('бухгалтерія', 'кладовщик'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const stock = await db.listStock({ search });
    res.json({ ok: true, stock });
  } catch (error) {
    console.error('GET /api/stock ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати склад' });
  }
});

app.get('/api/analytics/products', requireRole('бухгалтерія', 'кладовщик'), async (req, res) => {
  try {
    const analytics = await db.getProductAnalytics();
    res.json({ ok: true, analytics });
  } catch (error) {
    console.error('GET /api/analytics/products ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося порахувати аналітику' });
  }
});

app.get('/api/analytics/materials', requireRole('бухгалтерія', 'кладовщик'), async (req, res) => {
  try {
    const analytics = await db.getMaterialAnalytics();
    res.json({ ok: true, analytics });
  } catch (error) {
    console.error('GET /api/analytics/materials ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося порахувати аналітику розхідників' });
  }
});

app.get('/api/green-coffee', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const greenCoffee = await db.listGreenCoffee({ search });
    res.json({ ok: true, greenCoffee });
  } catch (error) {
    console.error('GET /api/green-coffee ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати зелену каву' });
  }
});

app.get('/api/green-coffee/movements-summary', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const dateFrom = String(req.query.dateFrom || '').trim();
    const dateTo = String(req.query.dateTo || '').trim();
    if (!dateFrom || !dateTo) {
      res.status(400).json({ ok: false, error: 'Потрібні dateFrom і dateTo' });
      return;
    }
    const summary = await db.listGreenCoffeeMovementsSummary({ dateFrom, dateTo });
    res.json({ ok: true, summary });
  } catch (error) {
    console.error('GET /api/green-coffee/movements-summary ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати аналітику' });
  }
});

app.post('/api/green-coffee/:code/needs-photoseparation', requireRole(), async (req, res) => {
  try {
    const { needs_photoseparation } = req.body || {};
    const rowCount = await db.updateGreenCoffeeNeedsPhotoseparation(req.params.code, needs_photoseparation);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Лот не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/green-coffee/:code/needs-photoseparation ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/green-coffee/:code/short-names', requireRole(), async (req, res) => {
  try {
    const { napivfabrykat_names } = req.body || {};
    const rowCount = await db.updateGreenCoffeeShortNames(req.params.code, napivfabrykat_names);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Лот не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/green-coffee/:code/short-names ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/green-coffee/:code/sap-code', requireRole(), async (req, res) => {
  try {
    const { sap_code } = req.body || {};
    const rowCount = await db.updateProductSapCode(req.params.code, sap_code);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Лот не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/green-coffee/:code/sap-code ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.get('/api/napivfabrykat', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const napivfabrykat = await db.listNapivfabrykat({ search });
    res.json({ ok: true, napivfabrykat });
  } catch (error) {
    console.error('GET /api/napivfabrykat ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати напівфабрикати' });
  }
});

app.post('/api/napivfabrykat/:code/sap-code', requireRole(), async (req, res) => {
  try {
    const { sap_code } = req.body || {};
    const rowCount = await db.updateProductSapCode(req.params.code, sap_code);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Напівфабрикат не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/napivfabrykat/:code/sap-code ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/napivfabrykat/:code/short-name', requireRole(), async (req, res) => {
  try {
    const { short_name } = req.body || {};
    const rowCount = await db.updateNapivfabrykatShortName(req.params.code, short_name);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Напівфабрикат не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/napivfabrykat/:code/short-name ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/napivfabrykat/:code/needs-photoseparation', requireRole(), async (req, res) => {
  try {
    const { needs_photoseparation } = req.body || {};
    const rowCount = await db.updateNapivfabrykatNeedsPhotoseparation(req.params.code, needs_photoseparation);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Напівфабрикат не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/napivfabrykat/:code/needs-photoseparation ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/napivfabrykat/:code/source', requireRole(), async (req, res) => {
  try {
    const { source_green_coffee_code } = req.body || {};
    const product = await db.updateNapivfabrykatSource(req.params.code, source_green_coffee_code);
    if (!product) {
      res.status(404).json({ ok: false, error: 'Напівфабрикат не знайдено' });
      return;
    }
    res.json({ ok: true, product });
  } catch (error) {
    console.error('POST /api/napivfabrykat/:code/source ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/napivfabrykat', requireRole(), async (req, res) => {
  try {
    const { source_green_coffee_code, short_name, needs_photoseparation, sap_code } = req.body || {};
    if (!source_green_coffee_code) {
      res.status(400).json({ ok: false, error: 'Обери лот зеленої кави' });
      return;
    }
    const product = await db.createNapivfabrykatProduct({ source_green_coffee_code, short_name, needs_photoseparation, sap_code });
    res.json({ ok: true, product });
  } catch (error) {
    console.error('POST /api/napivfabrykat ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося додати позицію' });
  }
});

app.post('/api/products/:code/rename', requireRole(), async (req, res) => {
  try {
    const { new_code } = req.body || {};
    await db.renameProductCode(req.params.code, new_code);
    res.json({ ok: true, code: String(new_code || '').trim() });
  } catch (error) {
    console.error('POST /api/products/:code/rename ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити код' });
  }
});

app.get('/api/roasting-batches', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const batches = await db.listRoastingBatches({ status });
    res.json({ ok: true, batches });
  } catch (error) {
    console.error('GET /api/roasting-batches ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати партії обсмажки' });
  }
});

app.post('/api/roasting-batches', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const { green_coffee_code, qty_green_kg, qty_roasted_kg, batch_date, note, napivfabrykat_code } = req.body || {};
    if (!green_coffee_code || !qty_green_kg || !qty_roasted_kg) {
      res.status(400).json({ ok: false, error: "Потрібні лот зеленої кави, вага взятого і вага смаженого" });
      return;
    }
    const batch = await db.createRoastingBatch({
      green_coffee_code, qty_green_kg, qty_roasted_kg, batch_date, note, napivfabrykat_code,
      created_by: req.account.username
    });
    res.json({ ok: true, batch });
  } catch (error) {
    console.error('POST /api/roasting-batches ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося записати партію' });
  }
});

app.post('/api/roasting-batches/:id/photoseparation', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const { weight_before_kg, weight_after_kg } = req.body || {};
    if (weight_before_kg === undefined || weight_after_kg === undefined) {
      res.status(400).json({ ok: false, error: 'Потрібні вага до і вага після' });
      return;
    }
    const batch = await db.recordPhotoseparation(Number(req.params.id), { weight_before_kg, weight_after_kg });
    res.json({ ok: true, batch });
  } catch (error) {
    console.error('POST /api/roasting-batches/:id/photoseparation ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти ваги' });
  }
});

app.get('/api/stations', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const stations = await db.listStations();
    res.json({ ok: true, stations });
  } catch (error) {
    console.error('GET /api/stations ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати список станцій' });
  }
});

app.get('/api/stations-status', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const stations = await db.listStationsWithStatus();
    res.json({ ok: true, stations });
  } catch (error) {
    console.error('GET /api/stations-status ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати стан станцій' });
  }
});

app.post('/api/stations/:name', requireRole(), async (req, res) => {
  try {
    const { note } = req.body || {};
    const station = await db.updateStation(req.params.name, { note });
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

app.post('/api/stations/:name/operations', requireRole(), async (req, res) => {
  try {
    const { operation_name, base_norm, target_norm, unit } = req.body || {};
    const operation = await db.upsertStationOperation({ station: req.params.name, operation_name, base_norm, target_norm, unit });
    res.json({ ok: true, operation });
  } catch (error) {
    console.error('POST /api/stations/:name/operations ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти норму' });
  }
});

app.post('/api/stations/:name/employees', requireRole(), async (req, res) => {
  try {
    const { employee_name, personal_norm, personal_norm_unit, schedule_note } = req.body || {};
    if (!employee_name) {
      res.status(400).json({ ok: false, error: 'Ім’я співробітника обов’язкове' });
      return;
    }
    const employee = await db.upsertStationEmployee({ station: req.params.name, employee_name, personal_norm, personal_norm_unit, schedule_note });
    res.json({ ok: true, employee });
  } catch (error) {
    console.error('POST /api/stations/:name/employees ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти співробітника' });
  }
});

app.delete('/api/station-operations/:id', requireRole(), async (req, res) => {
  try {
    const rowCount = await db.deleteStationOperation(Number(req.params.id));
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/station-operations/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося видалити' });
  }
});

app.delete('/api/station-employees/:id', requireRole(), async (req, res) => {
  try {
    const rowCount = await db.deleteStationEmployee(Number(req.params.id));
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/station-employees/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося видалити' });
  }
});

app.post('/api/tasks', requireRole('тімлід'), async (req, res) => {
  try {
    const { station, product_code, product_name, planned_qty, unit, task_date, reason, comment, recipe_id } = req.body || {};
    if (!station || !task_date) {
      res.status(400).json({ ok: false, error: 'Станція і дата обов’язкові' });
      return;
    }
    const task = await db.createTask({ station, product_code, product_name, planned_qty, unit, task_date, reason, comment, recipe_id: recipe_id || null });
    res.json({ ok: true, task });
  } catch (error) {
    console.error('POST /api/tasks ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити задачу' });
  }
});

app.post('/api/tasks/auto-assign', requireRole('тімлід'), async (req, res) => {
  try {
    const created = await db.autoAssignOrdersToStations();
    res.json({ ok: true, created });
  } catch (error) {
    console.error('POST /api/tasks/auto-assign ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося розподілити замовлення' });
  }
});

app.get('/api/tasks', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const { station = '', dateFrom = '', dateTo = '', status = '' } = req.query;
    const tasks = await db.listTasks({ station, dateFrom, dateTo, status });
    res.json({ ok: true, tasks });
  } catch (error) {
    console.error('GET /api/tasks ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати задачі' });
  }
});

// Роль "станція" (планшет на робочому місці) сама може лише почати, поставити
// на паузу чи завершити задачу — не скасувати, не заблокувати, не повернути
// у "заплановано". Це рішення адміністратора/тімліда (ТЗ §5.1).
const STATION_ALLOWED_STATUSES = new Set(['виконується', 'пауза', 'завершено']);

app.post('/api/tasks/:id/status', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const { status, actual_qty, comment } = req.body || {};
    if (!db.TASK_STATUSES.includes(status)) {
      res.status(400).json({ ok: false, error: 'Невідомий статус' });
      return;
    }
    if (req.account.role === 'станція' && !STATION_ALLOWED_STATUSES.has(status)) {
      res.status(403).json({ ok: false, error: 'Цей статус може встановити тільки адміністратор чи тімлід' });
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

app.get('/api/materials', requireRole('кладовщик'), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const materialType = String(req.query.materialType || '').trim();
    const excludeMaterialType = String(req.query.excludeMaterialType || '').trim();
    const materials = await db.listMaterials({ search, materialType, excludeMaterialType });
    res.json({ ok: true, materials });
  } catch (error) {
    console.error('GET /api/materials ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати розхідники' });
  }
});

app.post('/api/materials', requireRole(), async (req, res) => {
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

app.post('/api/materials/:id', requireRole(), async (req, res) => {
  try {
    const { station, min_stock, unit, reorder_period_days, material_type, availability_status, process_status, sap_code } = req.body || {};
    const material = await db.updateMaterialFields(Number(req.params.id), { station, min_stock, unit, reorder_period_days, material_type, availability_status, process_status, sap_code });
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

app.get('/api/materials/:id/movements', requireRole(), async (req, res) => {
  try {
    const movements = await db.listMaterialMovements(Number(req.params.id));
    res.json({ ok: true, movements });
  } catch (error) {
    console.error('GET /api/materials/:id/movements ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати історію рухів' });
  }
});

app.post('/api/material-movements', requireRole(), async (req, res) => {
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

app.get('/api/products/:code/specs', requireRole(), async (req, res) => {
  try {
    const specs = await db.listProductSpecs(req.params.code);
    res.json({ ok: true, specs });
  } catch (error) {
    console.error('GET /api/products/:code/specs ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати специфікацію' });
  }
});

app.post('/api/products/:code/specs', requireRole(), async (req, res) => {
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

app.delete('/api/product-specs/:id', requireRole(), async (req, res) => {
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

app.get('/api/blend-recipes', requireRole('тімлід', 'станція'), async (req, res) => {
  try {
    const recipes = await db.listBlendRecipes();
    res.json({ ok: true, recipes });
  } catch (error) {
    console.error('GET /api/blend-recipes ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати рецептури' });
  }
});

app.post('/api/orders/import', requireRole(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ ok: false, error: 'Файл не додано' });
      return;
    }
    const lines = await parseOrderFile(req.file.buffer);
    const result = await db.importOrderLines(lines);
    const autoAssigned = await db.autoAssignOrdersToStations();
    res.json({ ok: true, ...result, totalRows: lines.length, autoAssigned });
  } catch (error) {
    console.error('POST /api/orders/import ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося розпізнати файл' });
  }
});

app.get('/api/orders/import-duplicates', requireRole(), async (req, res) => {
  try {
    const duplicates = await db.listImportDuplicates();
    res.json({ ok: true, duplicates });
  } catch (error) {
    console.error('GET /api/orders/import-duplicates ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати список дублікатів' });
  }
});

app.get('/api/orders', requireRole('бухгалтерія', 'кладовщик'), async (req, res) => {
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

app.get('/api/orders/:orderNumber', requireRole('бухгалтерія', 'кладовщик'), async (req, res) => {
  try {
    const lines = await db.getOrderLines(req.params.orderNumber);
    res.json({ ok: true, lines });
  } catch (error) {
    console.error('GET /api/orders/:orderNumber ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати замовлення' });
  }
});

app.post('/api/orders/:orderNumber/lines', requireRole('кладовщик'), async (req, res) => {
  try {
    const { product_code, product_name, qty } = req.body || {};
    const line = await db.addOrderLine(req.params.orderNumber, { product_code, product_name, qty });
    res.json({ ok: true, line });
  } catch (error) {
    console.error('POST /api/orders/:orderNumber/lines ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося додати позицію' });
  }
});

app.post('/api/order-lines/:lineId/overrides', requireRole('кладовщик'), async (req, res) => {
  try {
    const { role, material_id, note } = req.body || {};
    if (!role || !material_id) {
      res.status(400).json({ ok: false, error: 'Потрібні role і material_id' });
      return;
    }
    const override = await db.upsertOrderLineOverride({
      order_line_id: Number(req.params.lineId),
      role,
      material_id,
      note,
      created_by: req.account.username
    });
    res.json({ ok: true, override });
  } catch (error) {
    console.error('POST /api/order-lines/:lineId/overrides ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти заміну' });
  }
});

app.delete('/api/order-line-overrides/:id', requireRole('кладовщик'), async (req, res) => {
  try {
    const rowCount = await db.deleteOrderLineOverride(Number(req.params.id));
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/order-line-overrides/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося видалити' });
  }
});

app.post('/api/orders/:orderNumber/status', requireRole('кладовщик'), async (req, res) => {
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

app.post('/api/order-lines/:lineId/status', requireRole('кладовщик'), async (req, res) => {
  try {
    const { status, note } = req.body || {};
    if (!db.ORDER_STATUSES.includes(status)) {
      res.status(400).json({ ok: false, error: 'Невідомий статус' });
      return;
    }
    const rowCount = await db.updateOrderLineStatus(Number(req.params.lineId), status, note);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Позицію не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/order-lines/:lineId/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

app.post('/api/order-lines/:lineId/delivery', requireRole('кладовщик'), async (req, res) => {
  try {
    const { delivery_method, ttn } = req.body || {};
    const rowCount = await db.updateOrderLineDelivery(Number(req.params.lineId), delivery_method, ttn);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Позицію не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/order-lines/:lineId/delivery ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти доставку' });
  }
});

app.post('/api/order-lines/:lineId/substitute', requireRole('кладовщик'), async (req, res) => {
  try {
    const { product_code, qty, note } = req.body || {};
    if (!product_code) {
      res.status(400).json({ ok: false, error: 'Потрібен код товару' });
      return;
    }
    await db.substituteOrderLineProduct(Number(req.params.lineId), product_code, qty, note);
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/order-lines/:lineId/substitute ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося замінити товар' });
  }
});

app.post('/api/orders/:orderNumber/delivery', requireRole('кладовщик'), async (req, res) => {
  try {
    const { delivery_method, ttn } = req.body || {};
    const rowCount = await db.updateOrderDelivery(req.params.orderNumber, delivery_method, ttn);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Замовлення не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/orders/:orderNumber/delivery ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти доставку' });
  }
});

app.get('/api/clients', requireRole(), async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const clients = await db.listClients({ search });
    res.json({ ok: true, clients });
  } catch (error) {
    console.error('GET /api/clients ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати список клієнтів' });
  }
});

app.post('/api/clients/:customerCode', requireRole(), async (req, res) => {
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

app.get('/api/products/:code/movements', requireRole('бухгалтерія', 'кладовщик'), async (req, res) => {
  try {
    const movements = await db.listMovements(req.params.code);
    res.json({ ok: true, movements });
  } catch (error) {
    console.error('GET /api/products/:code/movements ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати історію рухів' });
  }
});

app.get('/api/inventory/dates', requireRole('бухгалтерія', 'кладовщик'), async (req, res) => {
  try {
    const dates = await db.listInventoryDates();
    res.json({ ok: true, dates });
  } catch (error) {
    console.error('GET /api/inventory/dates ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати дати інвентаризацій' });
  }
});

app.get('/api/inventory/dates/:date', requireRole('бухгалтерія', 'кладовщик'), async (req, res) => {
  try {
    const detail = await db.listInventoryDetail(req.params.date);
    res.json({ ok: true, detail });
  } catch (error) {
    console.error('GET /api/inventory/dates/:date ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати деталі інвентаризації' });
  }
});

app.get('/api/inventory/comparison', requireRole('бухгалтерія', 'кладовщик'), async (req, res) => {
  try {
    const comparison = await db.listInventoryComparison();
    res.json({ ok: true, comparison });
  } catch (error) {
    console.error('GET /api/inventory/comparison ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати порівняння' });
  }
});

app.post('/api/movements', requireRole('кладовщик'), async (req, res) => {
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

app.get('/api/accounts', requireRole(), async (req, res) => {
  try {
    const accounts = await db.listAccounts();
    res.json({ ok: true, accounts });
  } catch (error) {
    console.error('GET /api/accounts ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати список акаунтів' });
  }
});

app.post('/api/accounts/:username/password', requireRole(), async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      res.status(400).json({ ok: false, error: 'Пароль має бути щонайменше 6 символів' });
      return;
    }
    const rowCount = await db.updateAccountPassword(req.params.username, password);
    if (!rowCount) {
      res.status(404).json({ ok: false, error: 'Акаунт не знайдено' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('POST /api/accounts/:username/password ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити пароль' });
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

    const addedFinishedCount = await db.insertProductsIfMissing(seedFinishedProductsSap);
    if (addedFinishedCount > 0) {
      console.log(`Added ${addedFinishedCount} finished products from SAP catalog file`);
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

    const addedMaterialsCount = await db.insertMaterialsIfMissing(seedMaterialsSap);
    if (addedMaterialsCount > 0) {
      console.log(`Added ${addedMaterialsCount} materials from SAP catalog file`);
    }

    const addedStickersCount = await db.insertMaterialsIfMissing(seedStickers);
    if (addedStickersCount > 0) {
      console.log(`Added ${addedStickersCount} stickers`);
    }

    // Об'єднує різні варіанти написання станцій ("ручна" -> "Ручна") в одну
    // картку, потім заповнює реальні норми/операції/співробітників — усе
    // безпечно, ніколи не перезаписує те, що вже задано вручну.
    await db.normalizeStationNames(STATION_NAME_ALIASES);
    await db.insertStationsIfMissing(Object.values(STATION_NAME_ALIASES).concat(Object.keys(stationNotes)));
    for (const [name, note] of Object.entries(stationNotes)) {
      await db.updateStation(name, { note });
    }
    const addedOperations = await db.seedStationOperationsIfMissing(stationOperations);
    if (addedOperations > 0) {
      console.log(`Seeded ${addedOperations} station operations/norms`);
    }
    const addedEmployees = await db.seedStationEmployeesIfMissing(stationEmployees);
    if (addedEmployees > 0) {
      console.log(`Seeded ${addedEmployees} station employees`);
    }

    for (const account of seedAccounts) {
      await db.createAccountIfMissingWithHash(account);
    }

    const INVENTORY_BASELINE_NOTE = 'Інвентаризація 02.08.2026 (файл від Тетяни)';
    const alreadyImportedBaseline = await db.countMovementsByNote(INVENTORY_BASELINE_NOTE);
    if (alreadyImportedBaseline === 0) {
      await db.applyInventoryBaseline(seedInventoryAug2, { movement_date: '2026-08-02', note: INVENTORY_BASELINE_NOTE });
      console.log(`Applied inventory baseline: ${seedInventoryAug2.length} products (02.08.2026)`);
    }

    for (const name of seedKapranClients) {
      await db.upsertClientByName(name, { manager: 'Капран' });
    }

    const greenCoffeeInserted = await db.insertGreenCoffeeIfMissing(seedGreenCoffee);
    if (greenCoffeeInserted > 0) {
      console.log(`Imported green coffee lots: ${greenCoffeeInserted}`);
    }

    const greenCoffeeSapInserted = await db.insertGreenCoffeeSapCodesIfMissing(seedGreenCoffeeSap);
    if (greenCoffeeSapInserted > 0) {
      console.log(`Imported green coffee SAP codes: ${greenCoffeeSapInserted}`);
    }

    // Напівфабрикат-товар заводиться одразу для КОЖНОГО лоту зеленої кави,
    // який ще жодної позиції напівфабрикату не має (а не лише коли трапиться
    // перша партія обсмажки), щоб було куди одразу вносити задньочислові
    // коригування. Якщо лот вже має позицію(ї) (автозаведену чи додану
    // вручну на вкладці Напівфабрикати) — не чіпається.
    const napivfabrykatCreated = await db.ensureNapivfabrykatProducts();
    if (napivfabrykatCreated > 0) {
      console.log(`Created napivfabrykat products: ${napivfabrykatCreated}`);
    }

    // Colombia, Djimma GR5, Peru, Santos — одна зеленка, але два різних
    // напівфабрикати під різну продукцію. Розділяє на дві окремі позиції,
    // якщо ще не розділено (перезаписує "склеєну" коротку назву, якщо вона
    // там залишилась з-до того, як зʼявився цей крок).
    const napivfabrykatSplit = await db.splitMultiGradeNapivfabrykatPositions();
    if (napivfabrykatSplit > 0) {
      console.log(`Split multi-grade napivfabrykat positions: ${napivfabrykatSplit}`);
    }

    // Позиції напівфабрикату, заведені ще до появи короткої назви як
    // окремого поля — підтягує її з лот-листа зеленої кави там, де вона ще
    // порожня.
    const napivfabrykatShortNamesBackfilled = await db.backfillNapivfabrykatShortNames();
    if (napivfabrykatShortNamesBackfilled > 0) {
      console.log(`Backfilled napivfabrykat short names: ${napivfabrykatShortNamesBackfilled}`);
    }

    // Одноразовий масовий імпорт історичних замовлень (81 вкладка файлу,
    // серпень 2026) — позначені source='SAP-history', щоб відрізнити від
    // щоденних імпортів через веб-інтерфейс і щоб не повторювати цей крок
    // на кожен рестарт сервера.
    const alreadyImportedHistory = await db.countOrderLinesBySource('SAP-history');
    if (alreadyImportedHistory === 0) {
      const historyPath = path.join(__dirname, 'seed-orders-history.json');
      if (fs.existsSync(historyPath)) {
        const historyLines = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
        const result = await db.importOrderLines(historyLines);
        console.log(`Imported historical orders: ${JSON.stringify(result)}`);
      }
    }

    // Виправлення бага: (order_number, product_code) сам по собі був
    // завузьким ключем унікальності для позицій замовлення — той самий
    // товар МОЖЕ повторюватись у тому самому замовленні кількома рядками з
    // різною кількістю (напр. одна позиція їде на кілька різних точок
    // доставки), а importOrderLines() досі помилково відкидав такі рядки
    // як дублікати. Природно ідемпотентно (ON CONFLICT на новому,
    // ширшому ключі), безпечно на кожному старті.
    const recoveredLinesCount = await db.recoverMisclassifiedDuplicateOrderLines();
    if (recoveredLinesCount > 0) {
      console.log(`Recovered ${recoveredLinesCount} order lines wrongly dropped as duplicates`);
    }

    // Прибирає з активного списку станцій задачі, чиє замовлення насправді
    // вже відвантажене (природно ідемпотентно — торкається лише задач, що
    // ще не завершено/скасовано).
    const autoCompletedCount = await db.autoCompleteShippedOrderTasks();
    if (autoCompletedCount > 0) {
      console.log(`Auto-completed ${autoCompletedCount} station tasks whose order already shipped`);
    }

    // Одноразова міграція + виправлення багу: попередня версія backfill-у
    // орієнтувалась на "статус != відвантажено", що на кожному рестарті
    // сервера сприймало ручне скасування замовлення як "ще не оброблено" —
    // повертало статус на "відвантажено" і додавало дублікат руху списання.
    // migrateHistoricalBackfillMarker() спершу позначає вже оброблені рядки
    // назавжди (щоб новий backfill їх більше не чіпав), а
    // cleanupDuplicateHistoricalBackfillMovements() прибирає накопичені
    // дублікати рухів і повертає статус "скасовано" там, де його помилково
    // відкотило назад.
    const markedCount = await db.migrateHistoricalBackfillMarker();
    if (markedCount > 0) {
      console.log(`Marked ${markedCount} historical order lines as already backfilled`);
    }
    const cleanupResult = await db.cleanupDuplicateHistoricalBackfillMovements();
    if (cleanupResult.dupesRemoved > 0 || cleanupResult.statusesFixed > 0) {
      console.log(`Cleaned up historical backfill bug: ${JSON.stringify(cleanupResult)}`);
    }

    // Історичні замовлення по факту вже відвантажені в реальності — ставить
    // статус "відвантажено" всім, і списує зі складу ті, що після точки нуль
    // інвентаризації (до неї це вже враховано в порахованому залишку).
    const shipResult = await db.backfillHistoricalShipments({ baselineDate: '2026-08-02' });
    if (shipResult.movementsCreated > 0 || shipResult.statusOnly > 0) {
      console.log(`Historical shipments backfill: ${JSON.stringify(shipResult)}`);
    }

    // Уточнення від Тетяни: Nutty Boy 1000 (000009761) — 595 кг на 02.08,
    // не 532. Перший імпорт цю позицію пропустив через конфлікт у файлі.
    // Вносимо задніх числом (після того, як відвантаження вже записані) —
    // тому напряму, а не через звичайний addMovement (див. коментар у db.js).
    const NUTTY_BOY_NOTE = 'Інвентаризація 02.08.2026 (уточнено: 595 кг, Nutty Boy)';
    const nuttyBoyInserted = await db.insertBackdatedInventoryBaseline('000009761', 595, '2026-08-02', NUTTY_BOY_NOTE);
    if (nuttyBoyInserted > 0) {
      console.log('Applied Nutty Boy 1000 baseline correction: 595 kg');
    }
    // Лікує вже вставлений раніше (помилковою версією коду) рух, якщо він є.
    const nuttyBoyFixed = await db.fixBackdatedInventoryMovement('000009761', NUTTY_BOY_NOTE);
    if (nuttyBoyFixed > 0) {
      console.log('Fixed incorrectly-computed Nutty Boy baseline movement');
    }

    // Позиції без фізичної інвентаризації (виготовляються під замовлення) —
    // Тетяна підтвердила: вважаємо "виготовили стільки, скільки відвантажили",
    // вирівнюємо історичний мінус до 0 замість вигаданого числа.
    const MADE_TO_ORDER_NOTE = 'Вирівнювання до 0 (виготовлено під замовлення, історія серпня 2026)';
    if ((await db.countMovementsByNote(MADE_TO_ORDER_NOTE)) === 0) {
      const zeroedCount = await db.zeroOutMadeToOrderDeficits(MADE_TO_ORDER_NOTE);
      if (zeroedCount > 0) {
        console.log(`Zeroed out ${zeroedCount} made-to-order product deficits`);
      }
    }
  } catch (error) {
    console.error('Startup DB init ERROR:', error?.stack || error?.message || error);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Warehouse server started on port ${PORT}`);
  });

  // Прибирає прострочені сесії з таблиці (не впливає на те, коли саме
  // токен перестає працювати — це вирішує touchSession на кожен запит,
  // тут лише прибирання, щоб таблиця не росла безмежно).
  setInterval(() => {
    db.cleanupExpiredSessions().catch((error) => console.error('cleanupExpiredSessions ERROR:', error?.message || error));
  }, 15 * 60 * 1000);
})();
