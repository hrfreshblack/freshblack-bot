import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import seedAccounts from './seed-accounts.js';
import { signSsoToken, verifySsoToken } from './sso.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

const SESSION_COOKIE = 'fb_hr_session';
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
          setSessionCookie(res, token);
          return next();
        }
      }
    } catch (error) {
      console.error('Auth ERROR:', error?.message || error);
    }
  }
  res.status(401).json({ ok: false, error: 'Сесія завершена, увійдіть знову' });
}

// HRD завжди проходить (повний доступ, ТЗ п.4). Якщо перелік ролей
// порожній — маршрут лише для HRD.
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.account.role === 'HRD' || roles.includes(req.account.role)) return next();
    res.status(403).json({ ok: false, error: 'Немає доступу' });
  };
}

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

// Прийом переходу з іншого застосунку Fresh Black Workspace (ERP
// виробництва) — публічний маршрут (до authMiddleware), бо на цьому етапі
// своєї сесії ще нема. Токен підтверджує лише "цю людину щойно пропустила
// інша наша система" — заводить сесію тут, ЛИШЕ якщо в цьому застосунку
// вже є акаунт із таким самим username (нікого не створює й не підвищує
// права).
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
  const { username, role, display_name } = req.account;
  res.json({ ok: true, account: { username, role, display_name } });
});

app.get('/api/dictionaries', (req, res) => {
  res.json({ ok: true, employeeStatuses: db.EMPLOYEE_STATUSES, positionStatuses: db.POSITION_STATUSES, reservationStatuses: db.RESERVATION_STATUSES });
});

// ---- Departments ----

app.get('/api/departments', async (req, res) => {
  try {
    const departments = await db.listDepartments();
    res.json({ ok: true, departments });
  } catch (error) {
    console.error('GET /api/departments ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати департаменти' });
  }
});

app.post('/api/departments', requireRole(), async (req, res) => {
  try {
    const { name, parent_department_id, planned_headcount } = req.body || {};
    if (!name || !String(name).trim()) {
      res.status(400).json({ ok: false, error: 'Назва обов’язкова' });
      return;
    }
    const department = await db.createDepartment({ name: String(name).trim(), parent_department_id, planned_headcount });
    res.json({ ok: true, department });
  } catch (error) {
    console.error('POST /api/departments ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити департамент' });
  }
});

app.post('/api/departments/:id', requireRole(), async (req, res) => {
  try {
    const { name, parent_department_id, planned_headcount, active } = req.body || {};
    const department = await db.updateDepartment(Number(req.params.id), { name, parent_department_id, planned_headcount, active });
    if (!department) {
      res.status(404).json({ ok: false, error: 'Департамент не знайдено' });
      return;
    }
    res.json({ ok: true, department });
  } catch (error) {
    console.error('POST /api/departments/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити департамент' });
  }
});

// ---- Positions ----

app.get('/api/positions', async (req, res) => {
  try {
    const department_id = req.query.department_id ? Number(req.query.department_id) : null;
    const positions = await db.listPositions({ department_id });
    res.json({ ok: true, positions });
  } catch (error) {
    console.error('GET /api/positions ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати посади' });
  }
});

app.post('/api/positions', requireRole(), async (req, res) => {
  try {
    const { title, department_id, reports_to_position_id, status, is_department_head, note } = req.body || {};
    if (!title || !department_id) {
      res.status(400).json({ ok: false, error: 'Назва посади і департамент обов’язкові' });
      return;
    }
    const position = await db.createPosition({ title, department_id, reports_to_position_id, status, is_department_head, note });
    res.json({ ok: true, position });
  } catch (error) {
    console.error('POST /api/positions ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити посаду' });
  }
});

app.post('/api/positions/:id', requireRole(), async (req, res) => {
  try {
    const { title, department_id, reports_to_position_id, status, is_department_head, note, active } = req.body || {};
    const position = await db.updatePosition(Number(req.params.id), { title, department_id, reports_to_position_id, status, is_department_head, note, active });
    if (!position) {
      res.status(404).json({ ok: false, error: 'Посаду не знайдено' });
      return;
    }
    res.json({ ok: true, position });
  } catch (error) {
    console.error('POST /api/positions/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити посаду' });
  }
});

// ---- Org chart ----

app.get('/api/org-tree', async (req, res) => {
  try {
    const tree = await db.getOrgTree();
    res.json({ ok: true, ...tree });
  } catch (error) {
    console.error('GET /api/org-tree ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося побудувати оргструктуру' });
  }
});

// ---- Employees ----

app.get('/api/employees', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();
    const department_id = req.query.department_id ? Number(req.query.department_id) : null;
    const employees = await db.listEmployees({ search, status, department_id });
    res.json({ ok: true, employees });
  } catch (error) {
    console.error('GET /api/employees ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати список співробітників' });
  }
});

app.get('/api/employees/:id', async (req, res) => {
  try {
    const employee = await db.getEmployee(Number(req.params.id));
    if (!employee) {
      res.status(404).json({ ok: false, error: 'Співробітника не знайдено' });
      return;
    }
    res.json({ ok: true, employee });
  } catch (error) {
    console.error('GET /api/employees/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати профіль' });
  }
});

app.post('/api/employees', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.full_name || !String(body.full_name).trim()) {
      res.status(400).json({ ok: false, error: 'ПІБ обов’язкове' });
      return;
    }
    const employee = await db.createEmployee({ ...body, created_by: req.account.username });
    res.json({ ok: true, employee });
  } catch (error) {
    console.error('POST /api/employees ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити співробітника' });
  }
});

app.post('/api/employees/:id/personal', requireRole(), async (req, res) => {
  try {
    const employee = await db.getEmployee(Number(req.params.id));
    if (!employee) {
      res.status(404).json({ ok: false, error: 'Співробітника не знайдено' });
      return;
    }
    const person = await db.updatePersonFields(employee.person_id, req.body || {});
    res.json({ ok: true, person });
  } catch (error) {
    console.error('POST /api/employees/:id/personal ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/employees/:id/fields', requireRole(), async (req, res) => {
  try {
    const employee = await db.updateEmployeeFields(Number(req.params.id), req.body || {});
    if (!employee) {
      res.status(404).json({ ok: false, error: 'Співробітника не знайдено' });
      return;
    }
    res.json({ ok: true, employee });
  } catch (error) {
    console.error('POST /api/employees/:id/fields ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/employees/:id/status', requireRole(), async (req, res) => {
  try {
    const { status } = req.body || {};
    const employee = await db.updateEmployeeStatus(Number(req.params.id), status, req.account.username);
    if (!employee) {
      res.status(404).json({ ok: false, error: 'Співробітника не знайдено' });
      return;
    }
    res.json({ ok: true, employee });
  } catch (error) {
    console.error('POST /api/employees/:id/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

app.post('/api/employees/:id/employment', requireRole(), async (req, res) => {
  try {
    const period = await db.changeEmployment(Number(req.params.id), { ...(req.body || {}), created_by: req.account.username });
    res.json({ ok: true, period });
  } catch (error) {
    console.error('POST /api/employees/:id/employment ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти зміну працевлаштування' });
  }
});

app.post('/api/employees/:id/compensation', requireRole(), async (req, res) => {
  try {
    const record = await db.addCompensationRecord({ ...(req.body || {}), employee_id: Number(req.params.id), created_by: req.account.username });
    res.json({ ok: true, record });
  } catch (error) {
    console.error('POST /api/employees/:id/compensation ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти компенсацію' });
  }
});

app.get('/api/audit-log', requireRole(), async (req, res) => {
  try {
    const entity_type = String(req.query.entity_type || '');
    const entity_id = req.query.entity_id ? Number(req.query.entity_id) : null;
    const entries = await db.listAuditLog({ entity_type, entity_id });
    res.json({ ok: true, entries });
  } catch (error) {
    console.error('GET /api/audit-log ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати журнал змін' });
  }
});

(async () => {
  try {
    await db.initSchema();

    for (const account of seedAccounts) {
      await db.createAccountIfMissingWithHash(account);
    }
  } catch (error) {
    console.error('Startup DB init ERROR:', error?.stack || error?.message || error);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HR server started on port ${PORT}`);
  });

  setInterval(() => {
    db.cleanupExpiredSessions().catch((error) => console.error('cleanupExpiredSessions ERROR:', error?.message || error));
  }, 15 * 60 * 1000);
})();
