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
  res.json({
    ok: true,
    employeeStatuses: db.EMPLOYEE_STATUSES,
    positionStatuses: db.POSITION_STATUSES,
    reservationStatuses: db.RESERVATION_STATUSES,
    vacancyRequestStatuses: db.VACANCY_REQUEST_STATUSES,
    vacancyStatuses: db.VACANCY_STATUSES,
    applicationStages: db.APPLICATION_STAGES,
    applicationStatuses: db.APPLICATION_STATUSES,
    rejectionReasonsCompany: db.REJECTION_REASONS_COMPANY,
    rejectionReasonsCandidate: db.REJECTION_REASONS_CANDIDATE,
    offerStatuses: db.OFFER_STATUSES,
    interviewTypes: db.INTERVIEW_TYPES,
    interviewStatuses: db.INTERVIEW_STATUSES
  });
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

// ---- Recruitment / ATS: Vacancy Requests ----

app.get('/api/vacancy-requests', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const requests = await db.listVacancyRequests({ status });
    res.json({ ok: true, requests });
  } catch (error) {
    console.error('GET /api/vacancy-requests ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати заявки на вакансії' });
  }
});

app.get('/api/vacancy-requests/:id', async (req, res) => {
  try {
    const request = await db.getVacancyRequest(Number(req.params.id));
    if (!request) {
      res.status(404).json({ ok: false, error: 'Заявку не знайдено' });
      return;
    }
    res.json({ ok: true, request });
  } catch (error) {
    console.error('GET /api/vacancy-requests/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати заявку' });
  }
});

app.post('/api/vacancy-requests', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.position_title || !body.department_id) {
      res.status(400).json({ ok: false, error: 'Назва посади і департамент обов’язкові' });
      return;
    }
    const request = await db.createVacancyRequest(body, req.account.username);
    res.json({ ok: true, request });
  } catch (error) {
    console.error('POST /api/vacancy-requests ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити заявку' });
  }
});

app.post('/api/vacancy-requests/:id', requireRole(), async (req, res) => {
  try {
    const request = await db.updateVacancyRequest(Number(req.params.id), req.body || {});
    if (!request) {
      res.status(404).json({ ok: false, error: 'Заявку не знайдено' });
      return;
    }
    res.json({ ok: true, request });
  } catch (error) {
    console.error('POST /api/vacancy-requests/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити заявку' });
  }
});

app.post('/api/vacancy-requests/:id/status', requireRole(), async (req, res) => {
  try {
    const { status, status_note } = req.body || {};
    const request = await db.updateVacancyRequestStatus(Number(req.params.id), status, status_note, req.account.username);
    if (!request) {
      res.status(404).json({ ok: false, error: 'Заявку не знайдено' });
      return;
    }
    res.json({ ok: true, request });
  } catch (error) {
    console.error('POST /api/vacancy-requests/:id/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

app.post('/api/vacancy-requests/:id/convert', requireRole(), async (req, res) => {
  try {
    const { position_id, recruiter_username, target_date, priority } = req.body || {};
    const vacancy = await db.convertVacancyRequestToVacancy(Number(req.params.id), { position_id, recruiter_username, target_date, priority }, req.account.username);
    res.json({ ok: true, vacancy });
  } catch (error) {
    console.error('POST /api/vacancy-requests/:id/convert ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося конвертувати у вакансію' });
  }
});

// ---- Recruitment / ATS: Vacancies ----

app.get('/api/vacancies', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const vacancies = await db.listVacancies({ status });
    res.json({ ok: true, vacancies });
  } catch (error) {
    console.error('GET /api/vacancies ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати вакансії' });
  }
});

app.get('/api/vacancies/:id', async (req, res) => {
  try {
    const vacancy = await db.getVacancy(Number(req.params.id));
    if (!vacancy) {
      res.status(404).json({ ok: false, error: 'Вакансію не знайдено' });
      return;
    }
    res.json({ ok: true, vacancy });
  } catch (error) {
    console.error('GET /api/vacancies/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати вакансію' });
  }
});

app.post('/api/vacancies', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.department_id) {
      res.status(400).json({ ok: false, error: 'Назва і департамент обов’язкові' });
      return;
    }
    const vacancy = await db.createVacancy(body, req.account.username);
    res.json({ ok: true, vacancy });
  } catch (error) {
    console.error('POST /api/vacancies ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити вакансію' });
  }
});

app.post('/api/vacancies/:id', requireRole(), async (req, res) => {
  try {
    const vacancy = await db.updateVacancy(Number(req.params.id), req.body || {});
    if (!vacancy) {
      res.status(404).json({ ok: false, error: 'Вакансію не знайдено' });
      return;
    }
    res.json({ ok: true, vacancy });
  } catch (error) {
    console.error('POST /api/vacancies/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити вакансію' });
  }
});

app.post('/api/vacancies/:id/status', requireRole(), async (req, res) => {
  try {
    const { status } = req.body || {};
    const vacancy = await db.updateVacancyStatus(Number(req.params.id), status, req.account.username);
    if (!vacancy) {
      res.status(404).json({ ok: false, error: 'Вакансію не знайдено' });
      return;
    }
    res.json({ ok: true, vacancy });
  } catch (error) {
    console.error('POST /api/vacancies/:id/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

// ---- Recruitment / ATS: Candidates ----

app.get('/api/candidates', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const candidates = await db.listCandidates({ search });
    res.json({ ok: true, candidates });
  } catch (error) {
    console.error('GET /api/candidates ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати кандидатів' });
  }
});

app.get('/api/candidates/:id', async (req, res) => {
  try {
    const candidate = await db.getCandidate(Number(req.params.id));
    if (!candidate) {
      res.status(404).json({ ok: false, error: 'Кандидата не знайдено' });
      return;
    }
    res.json({ ok: true, candidate });
  } catch (error) {
    console.error('GET /api/candidates/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати кандидата' });
  }
});

app.post('/api/candidates', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.full_name || !String(body.full_name).trim()) {
      res.status(400).json({ ok: false, error: 'ПІБ обов’язкове' });
      return;
    }
    const result = await db.createCandidate(body, req.account.username);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('POST /api/candidates ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити кандидата' });
  }
});

app.post('/api/candidates/:id', requireRole(), async (req, res) => {
  try {
    const candidate = await db.updateCandidateFields(Number(req.params.id), req.body || {});
    if (!candidate) {
      res.status(404).json({ ok: false, error: 'Кандидата не знайдено' });
      return;
    }
    res.json({ ok: true, candidate });
  } catch (error) {
    console.error('POST /api/candidates/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/candidates/:id/personal', requireRole(), async (req, res) => {
  try {
    const candidate = await db.getCandidate(Number(req.params.id));
    if (!candidate) {
      res.status(404).json({ ok: false, error: 'Кандидата не знайдено' });
      return;
    }
    const person = await db.updatePersonFields(candidate.person_id, req.body || {});
    res.json({ ok: true, person });
  } catch (error) {
    console.error('POST /api/candidates/:id/personal ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

// ---- Recruitment / ATS: Applications ----

app.get('/api/applications/:id', async (req, res) => {
  try {
    const application = await db.getApplication(Number(req.params.id));
    if (!application) {
      res.status(404).json({ ok: false, error: 'Заявку не знайдено' });
      return;
    }
    res.json({ ok: true, application });
  } catch (error) {
    console.error('GET /api/applications/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати заявку' });
  }
});

app.post('/api/applications', requireRole(), async (req, res) => {
  try {
    const { candidate_id, vacancy_id, applied_date } = req.body || {};
    if (!candidate_id || !vacancy_id) {
      res.status(400).json({ ok: false, error: 'Кандидат і вакансія обов’язкові' });
      return;
    }
    const application = await db.createApplication({ candidate_id, vacancy_id, applied_date }, req.account.username);
    res.json({ ok: true, application });
  } catch (error) {
    console.error('POST /api/applications ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити заявку' });
  }
});

app.post('/api/applications/:id/stage', requireRole(), async (req, res) => {
  try {
    const { stage } = req.body || {};
    const application = await db.updateApplicationStage(Number(req.params.id), stage, req.account.username);
    if (!application) {
      res.status(404).json({ ok: false, error: 'Заявку не знайдено' });
      return;
    }
    res.json({ ok: true, application });
  } catch (error) {
    console.error('POST /api/applications/:id/stage ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити етап' });
  }
});

app.post('/api/applications/:id/status', requireRole(), async (req, res) => {
  try {
    const application = await db.updateApplicationStatus(Number(req.params.id), req.body || {}, req.account.username);
    if (!application) {
      res.status(404).json({ ok: false, error: 'Заявку не знайдено' });
      return;
    }
    res.json({ ok: true, application });
  } catch (error) {
    console.error('POST /api/applications/:id/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

// ---- Recruitment / ATS: Interviews ----

app.post('/api/applications/:id/interviews', requireRole(), async (req, res) => {
  try {
    const interview = await db.createInterview({ ...(req.body || {}), application_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, interview });
  } catch (error) {
    console.error('POST /api/applications/:id/interviews ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити інтерв’ю' });
  }
});

app.post('/api/interviews/:id', requireRole(), async (req, res) => {
  try {
    const interview = await db.updateInterview(Number(req.params.id), req.body || {});
    if (!interview) {
      res.status(404).json({ ok: false, error: 'Інтерв’ю не знайдено' });
      return;
    }
    res.json({ ok: true, interview });
  } catch (error) {
    console.error('POST /api/interviews/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити інтерв’ю' });
  }
});

// ---- Recruitment / ATS: Offers ----

app.post('/api/applications/:id/offers', requireRole(), async (req, res) => {
  try {
    const offer = await db.createOffer({ ...(req.body || {}), application_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, offer });
  } catch (error) {
    console.error('POST /api/applications/:id/offers ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити офер' });
  }
});

app.post('/api/offers/:id', requireRole(), async (req, res) => {
  try {
    const offer = await db.updateOffer(Number(req.params.id), req.body || {});
    if (!offer) {
      res.status(404).json({ ok: false, error: 'Офер не знайдено' });
      return;
    }
    res.json({ ok: true, offer });
  } catch (error) {
    console.error('POST /api/offers/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити офер' });
  }
});

app.post('/api/offers/:id/status', requireRole(), async (req, res) => {
  try {
    const { status, approved_by } = req.body || {};
    const offer = await db.updateOfferStatus(Number(req.params.id), status, req.account.username, approved_by);
    if (!offer) {
      res.status(404).json({ ok: false, error: 'Офер не знайдено' });
      return;
    }
    res.json({ ok: true, offer });
  } catch (error) {
    console.error('POST /api/offers/:id/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус офера' });
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
