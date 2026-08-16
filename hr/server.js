import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import db from './db.js';
import seedAccounts from './seed-accounts.js';
import { signSsoToken, verifySsoToken } from './sso.js';

const resumeUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
function uploadSingleFile(req, res) {
  return new Promise((resolve, reject) => {
    resumeUpload.single('file')(req, res, (err) => {
      if (err) { reject(err); return; }
      // Busboy (усередині multer) декодує заголовок Content-Disposition як
      // latin1 за замовчуванням — браузер же шле саме UTF-8 байти імені
      // файлу без RFC 5987-екранування, тож кирилиця приходить "кракозябрами"
      // (класичний double-encoding). Перекодовуємо назад у UTF-8.
      if (req.file) {
        req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      }
      resolve();
    });
  });
}

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
    interviewStatuses: db.INTERVIEW_STATUSES,
    onboardingMilestones: db.ONBOARDING_MILESTONES,
    onboardingTaskStatuses: db.ONBOARDING_TASK_STATUSES,
    onboardingTemplateScopes: db.ONBOARDING_TEMPLATE_SCOPES,
    probationDecisions: db.PROBATION_DECISIONS,
    oneOnOneStatuses: db.ONE_ON_ONE_STATUSES,
    actionItemStatuses: db.ACTION_ITEM_STATUSES,
    performanceReviewStatuses: db.PERFORMANCE_REVIEW_STATUSES,
    okrOwnerTypes: db.OKR_OWNER_TYPES,
    okrObjectiveStatuses: db.OKR_OBJECTIVE_STATUSES,
    okrConfidenceLevels: db.OKR_CONFIDENCE_LEVELS,
    kpiSources: db.KPI_SOURCES,
    kpiStatuses: db.KPI_STATUSES,
    pdpItemStatuses: db.PDP_ITEM_STATUSES,
    kbCategories: db.KB_CATEGORIES,
    kbAudienceTypes: db.KB_AUDIENCE_TYPES,
    kbAssignmentStatuses: db.KB_ASSIGNMENT_STATUSES,
    learningPathScopes: db.LEARNING_PATH_SCOPES,
    learningItemTypes: db.LEARNING_ITEM_TYPES,
    learningAssignmentStatuses: db.LEARNING_ASSIGNMENT_STATUSES,
    surveyTypes: db.SURVEY_TYPES,
    surveyStatuses: db.SURVEY_STATUSES,
    surveyQuestionTypes: db.SURVEY_QUESTION_TYPES,
    absenceTypes: db.ABSENCE_TYPES,
    absenceStatuses: db.ABSENCE_STATUSES,
    offboardingInitiationTypes: db.OFFBOARDING_INITIATION_TYPES,
    offboardingStatuses: db.OFFBOARDING_STATUSES,
    offboardingChecklistCategories: db.OFFBOARDING_CHECKLIST_CATEGORIES,
    offboardingChecklistStatuses: db.OFFBOARDING_CHECKLIST_STATUSES,
    recommendCompanyOptions: db.RECOMMEND_COMPANY_OPTIONS
  });
});

app.get('/api/dashboard/metrics', async (req, res) => {
  try {
    const metrics = await db.getDashboardMetrics();
    res.json({ ok: true, metrics });
  } catch (error) {
    console.error('GET /api/dashboard/metrics ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося порахувати метрики' });
  }
});

app.get('/api/dashboard/recruitment-metrics', async (req, res) => {
  try {
    const metrics = await db.getRecruitmentMetrics();
    res.json({ ok: true, metrics });
  } catch (error) {
    console.error('GET /api/dashboard/recruitment-metrics ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося порахувати метрики' });
  }
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

app.post('/api/vacancy-requests', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/vacancy-requests/:id', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/vacancy-requests/:id/status', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/vacancy-requests/:id/convert', requireRole('Recruiter'), async (req, res) => {
  try {
    const { position_id, recruiter_username, target_date, priority } = req.body || {};
    const vacancy = await db.convertVacancyRequestToVacancy(Number(req.params.id), { position_id, recruiter_username, target_date, priority }, req.account.username);
    res.json({ ok: true, vacancy });
  } catch (error) {
    console.error('POST /api/vacancy-requests/:id/convert ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося конвертувати у вакансію' });
  }
});

app.post('/api/vacancy-requests/:id/attachments', requireRole('Recruiter'), async (req, res) => {
  try {
    await uploadSingleFile(req, res);
    if (!req.file) {
      res.status(400).json({ ok: false, error: 'Файл обов’язковий' });
      return;
    }
    const attachment = await db.addVacancyRequestAttachment(
      Number(req.params.id),
      { buffer: req.file.buffer, filename: req.file.originalname, mimeType: req.file.mimetype },
      req.account.username
    );
    res.json({ ok: true, attachment });
  } catch (error) {
    console.error('POST /api/vacancy-requests/:id/attachments ERROR:', error?.message || error);
    const message = error?.message?.includes('File too large') ? 'Файл завеликий (максимум 15МБ)' : (error?.message || 'Не вдалося завантажити файл');
    res.status(400).json({ ok: false, error: message });
  }
});

app.get('/api/vacancy-requests/:id/attachments', async (req, res) => {
  try {
    const attachments = await db.listVacancyRequestAttachments(Number(req.params.id));
    res.json({ ok: true, attachments });
  } catch (error) {
    console.error('GET /api/vacancy-requests/:id/attachments ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати файли' });
  }
});

app.get('/api/vacancy-request-attachments/:id/download', async (req, res) => {
  try {
    const file = await db.getVacancyRequestAttachmentFile(Number(req.params.id));
    if (!file) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.set('Content-Type', file.mime_type || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    res.send(file.file_data);
  } catch (error) {
    console.error('GET /api/vacancy-request-attachments/:id/download ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося завантажити файл' });
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

app.post('/api/vacancies', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/vacancies/:id', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/vacancies/:id/status', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/candidates', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/candidates/upload-resume', requireRole('Recruiter'), async (req, res) => {
  try {
    await uploadSingleFile(req, res);
    if (!req.file) {
      res.status(400).json({ ok: false, error: 'Файл обов’язковий' });
      return;
    }
    const result = await db.uploadResumeAndMatchCandidate(
      { buffer: req.file.buffer, filename: req.file.originalname, mimeType: req.file.mimetype },
      req.account.username
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('POST /api/candidates/upload-resume ERROR:', error?.message || error);
    const message = error?.message?.includes('File too large') ? 'Файл завеликий (максимум 15МБ)' : (error?.message || 'Не вдалося завантажити резюме');
    res.status(400).json({ ok: false, error: message });
  }
});

app.post('/api/candidates/:id', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/candidates/:id/personal', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/applications', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/applications/:id/stage', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/applications/:id/status', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/applications/:id/interviews', requireRole('Recruiter'), async (req, res) => {
  try {
    const interview = await db.createInterview({ ...(req.body || {}), application_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, interview });
  } catch (error) {
    console.error('POST /api/applications/:id/interviews ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити інтерв’ю' });
  }
});

app.post('/api/interviews/:id', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/applications/:id/offers', requireRole('Recruiter'), async (req, res) => {
  try {
    const offer = await db.createOffer({ ...(req.body || {}), application_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, offer });
  } catch (error) {
    console.error('POST /api/applications/:id/offers ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити офер' });
  }
});

app.post('/api/offers/:id', requireRole('Recruiter'), async (req, res) => {
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

app.post('/api/offers/:id/status', requireRole('Recruiter'), async (req, res) => {
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

// ---- Onboarding / Adaptation: templates ----

app.get('/api/onboarding-templates', async (req, res) => {
  try {
    const department_id = req.query.department_id ? Number(req.query.department_id) : null;
    const position_id = req.query.position_id ? Number(req.query.position_id) : null;
    const templates = await db.listOnboardingTemplates({ department_id, position_id });
    res.json({ ok: true, templates });
  } catch (error) {
    console.error('GET /api/onboarding-templates ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати шаблони' });
  }
});

app.post('/api/onboarding-templates', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.milestone) {
      res.status(400).json({ ok: false, error: 'Назва і етап обов’язкові' });
      return;
    }
    const template = await db.createOnboardingTemplate(body);
    res.json({ ok: true, template });
  } catch (error) {
    console.error('POST /api/onboarding-templates ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити шаблон' });
  }
});

app.post('/api/onboarding-templates/:id', requireRole(), async (req, res) => {
  try {
    const template = await db.updateOnboardingTemplate(Number(req.params.id), req.body || {});
    if (!template) {
      res.status(404).json({ ok: false, error: 'Шаблон не знайдено' });
      return;
    }
    res.json({ ok: true, template });
  } catch (error) {
    console.error('POST /api/onboarding-templates/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити шаблон' });
  }
});

// ---- Onboarding / Adaptation: per-employee tasks ----

app.get('/api/employees/:id/onboarding-tasks', async (req, res) => {
  try {
    const tasks = await db.listOnboardingTasks(Number(req.params.id));
    res.json({ ok: true, tasks });
  } catch (error) {
    console.error('GET /api/employees/:id/onboarding-tasks ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати задачі' });
  }
});

app.post('/api/employees/:id/onboarding-tasks/generate', requireRole(), async (req, res) => {
  try {
    const employee = await db.getEmployee(Number(req.params.id));
    if (!employee) {
      res.status(404).json({ ok: false, error: 'Співробітника не знайдено' });
      return;
    }
    const cur = employee.current_period;
    const tasks = await db.generateOnboardingTasks(employee.id, {
      department_id: cur?.department_id || null,
      position_id: cur?.position_id || null,
      start_date: cur?.start_date || employee.first_hire_date
    }, req.account.username);
    res.json({ ok: true, tasks });
  } catch (error) {
    console.error('POST /api/employees/:id/onboarding-tasks/generate ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося згенерувати задачі' });
  }
});

app.post('/api/employees/:id/onboarding-tasks', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.milestone) {
      res.status(400).json({ ok: false, error: 'Назва і етап обов’язкові' });
      return;
    }
    const task = await db.createAdHocOnboardingTask({ ...body, employee_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, task });
  } catch (error) {
    console.error('POST /api/employees/:id/onboarding-tasks ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити задачу' });
  }
});

app.post('/api/onboarding-tasks/:id', requireRole(), async (req, res) => {
  try {
    const task = await db.updateOnboardingTask(Number(req.params.id), req.body || {}, req.account.username);
    if (!task) {
      res.status(404).json({ ok: false, error: 'Задачу не знайдено' });
      return;
    }
    res.json({ ok: true, task });
  } catch (error) {
    console.error('POST /api/onboarding-tasks/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити задачу' });
  }
});

// ---- Preboarding ----

app.get('/api/employees/:id/preboarding', async (req, res) => {
  try {
    const info = await db.getPreboardingInfo(Number(req.params.id));
    res.json({ ok: true, info });
  } catch (error) {
    console.error('GET /api/employees/:id/preboarding ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати preboarding-дані' });
  }
});

app.post('/api/employees/:id/preboarding', requireRole('Recruiter'), async (req, res) => {
  try {
    const info = await db.upsertPreboardingInfo(Number(req.params.id), req.body || {});
    res.json({ ok: true, info });
  } catch (error) {
    console.error('POST /api/employees/:id/preboarding ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.get('/api/employees/:id/welcome-letter-draft', async (req, res) => {
  try {
    const employee = await db.getEmployee(Number(req.params.id));
    if (!employee) {
      res.status(404).json({ ok: false, error: 'Співробітника не знайдено' });
      return;
    }
    const info = await db.getPreboardingInfo(employee.id);
    const cur = employee.current_period;
    const text = db.buildWelcomeLetterText({
      full_name: employee.full_name,
      first_hire_date: employee.first_hire_date,
      position_title: cur?.position_title,
      department_name: cur?.department_name
    }, info);
    res.json({ ok: true, text });
  } catch (error) {
    console.error('GET /api/employees/:id/welcome-letter-draft ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося згенерувати чернетку' });
  }
});

// ---- Probation ----

app.post('/api/employees/:id/probation', requireRole(), async (req, res) => {
  try {
    const employee = await db.setProbation(Number(req.params.id), req.body || {});
    if (!employee) {
      res.status(404).json({ ok: false, error: 'Співробітника не знайдено' });
      return;
    }
    res.json({ ok: true, employee });
  } catch (error) {
    console.error('POST /api/employees/:id/probation ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/employees/:id/probation-decision', requireRole(), async (req, res) => {
  try {
    const employee = await db.recordProbationDecision(Number(req.params.id), req.body || {}, req.account.username);
    if (!employee) {
      res.status(404).json({ ok: false, error: 'Співробітника не знайдено' });
      return;
    }
    res.json({ ok: true, employee });
  } catch (error) {
    console.error('POST /api/employees/:id/probation-decision ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти рішення' });
  }
});

// ---- Performance: 1:1 ----

app.get('/api/employees/:id/one-on-ones', async (req, res) => {
  try {
    const meetings = await db.listOneOnOnes(Number(req.params.id));
    res.json({ ok: true, meetings });
  } catch (error) {
    console.error('GET /api/employees/:id/one-on-ones ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати 1:1' });
  }
});

app.post('/api/employees/:id/one-on-ones', requireRole(), async (req, res) => {
  try {
    const meeting = await db.createOneOnOne({ ...(req.body || {}), employee_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, meeting });
  } catch (error) {
    console.error('POST /api/employees/:id/one-on-ones ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/one-on-ones/:id', requireRole(), async (req, res) => {
  try {
    const meeting = await db.updateOneOnOne(Number(req.params.id), req.body || {});
    if (!meeting) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, meeting });
  } catch (error) {
    console.error('POST /api/one-on-ones/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/one-on-ones/:id/actions', requireRole(), async (req, res) => {
  try {
    const action = await db.addOneOnOneAction({ ...(req.body || {}), one_on_one_id: Number(req.params.id) });
    res.json({ ok: true, action });
  } catch (error) {
    console.error('POST /api/one-on-ones/:id/actions ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/one-on-one-actions/:id', requireRole(), async (req, res) => {
  try {
    const action = await db.updateOneOnOneAction(Number(req.params.id), req.body || {});
    if (!action) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, action });
  } catch (error) {
    console.error('POST /api/one-on-one-actions/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

// ---- Performance Review ----

app.get('/api/employees/:id/performance-reviews', async (req, res) => {
  try {
    const reviews = await db.listPerformanceReviews(Number(req.params.id));
    res.json({ ok: true, reviews });
  } catch (error) {
    console.error('GET /api/employees/:id/performance-reviews ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати ревʼю' });
  }
});

app.post('/api/employees/:id/performance-reviews', requireRole(), async (req, res) => {
  try {
    const review = await db.createPerformanceReview({ ...(req.body || {}), employee_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, review });
  } catch (error) {
    console.error('POST /api/employees/:id/performance-reviews ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/performance-reviews/:id', requireRole(), async (req, res) => {
  try {
    const review = await db.updatePerformanceReview(Number(req.params.id), req.body || {});
    if (!review) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, review });
  } catch (error) {
    console.error('POST /api/performance-reviews/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

// ---- OKR ----

app.get('/api/okr-objectives', async (req, res) => {
  try {
    const { owner_type, period } = req.query;
    const owner_department_id = req.query.owner_department_id ? Number(req.query.owner_department_id) : null;
    const owner_employee_id = req.query.owner_employee_id ? Number(req.query.owner_employee_id) : null;
    const objectives = await db.listObjectives({ owner_type: owner_type || '', owner_department_id, owner_employee_id, period: period || '' });
    res.json({ ok: true, objectives });
  } catch (error) {
    console.error('GET /api/okr-objectives ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати OKR' });
  }
});

app.get('/api/okr-objectives/:id', async (req, res) => {
  try {
    const objective = await db.getObjective(Number(req.params.id));
    if (!objective) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, objective });
  } catch (error) {
    console.error('GET /api/okr-objectives/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати' });
  }
});

app.post('/api/okr-objectives', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.owner_type) {
      res.status(400).json({ ok: false, error: 'Назва і тип власника обов’язкові' });
      return;
    }
    const objective = await db.createObjective(body, req.account.username);
    res.json({ ok: true, objective });
  } catch (error) {
    console.error('POST /api/okr-objectives ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/okr-objectives/:id/status', requireRole(), async (req, res) => {
  try {
    const objective = await db.updateObjectiveStatus(Number(req.params.id), (req.body || {}).status);
    if (!objective) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, objective });
  } catch (error) {
    console.error('POST /api/okr-objectives/:id/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

app.post('/api/okr-objectives/:id/key-results', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title) {
      res.status(400).json({ ok: false, error: 'Назва обов’язкова' });
      return;
    }
    const keyResult = await db.createKeyResult({ ...body, objective_id: Number(req.params.id) });
    res.json({ ok: true, keyResult });
  } catch (error) {
    console.error('POST /api/okr-objectives/:id/key-results ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/okr-key-results/:id/checkins', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (body.value === undefined || body.value === null || body.value === '') {
      res.status(400).json({ ok: false, error: 'Значення обов’язкове' });
      return;
    }
    const result = await db.addOkrCheckin({ ...body, key_result_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('POST /api/okr-key-results/:id/checkins ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/okr-key-results/:id/confidence', requireRole(), async (req, res) => {
  try {
    const keyResult = await db.updateKeyResultConfidence(Number(req.params.id), (req.body || {}).confidence);
    if (!keyResult) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, keyResult });
  } catch (error) {
    console.error('POST /api/okr-key-results/:id/confidence ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

// ---- KPI ----

app.get('/api/kpi-templates', async (req, res) => {
  try {
    const position_id = req.query.position_id ? Number(req.query.position_id) : null;
    const templates = await db.listKpiTemplates({ position_id });
    res.json({ ok: true, templates });
  } catch (error) {
    console.error('GET /api/kpi-templates ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати шаблони KPI' });
  }
});

app.post('/api/kpi-templates', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.position_id || !body.name) {
      res.status(400).json({ ok: false, error: 'Посада і назва обов’язкові' });
      return;
    }
    const template = await db.createKpiTemplate(body);
    res.json({ ok: true, template });
  } catch (error) {
    console.error('POST /api/kpi-templates ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/kpi-templates/:id', requireRole(), async (req, res) => {
  try {
    const template = await db.updateKpiTemplate(Number(req.params.id), req.body || {});
    if (!template) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, template });
  } catch (error) {
    console.error('POST /api/kpi-templates/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

app.get('/api/employees/:id/kpis', async (req, res) => {
  try {
    const kpis = await db.listKpisForEmployee(Number(req.params.id));
    res.json({ ok: true, kpis });
  } catch (error) {
    console.error('GET /api/employees/:id/kpis ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати KPI' });
  }
});

app.post('/api/employees/:id/kpis', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.template_id && !body.name) {
      res.status(400).json({ ok: false, error: 'Обери шаблон або вкажи назву' });
      return;
    }
    const kpi = await db.createKpiForEmployee({ ...body, employee_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, kpi });
  } catch (error) {
    console.error('POST /api/employees/:id/kpis ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/kpis/:id', requireRole(), async (req, res) => {
  try {
    const kpi = await db.updateKpi(Number(req.params.id), req.body || {});
    if (!kpi) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, kpi });
  } catch (error) {
    console.error('POST /api/kpis/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

// ---- Development Plan / PDP ----

app.get('/api/employees/:id/development-plan', async (req, res) => {
  try {
    const items = await db.listDevelopmentPlanItems(Number(req.params.id));
    res.json({ ok: true, items });
  } catch (error) {
    console.error('GET /api/employees/:id/development-plan ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати' });
  }
});

app.post('/api/employees/:id/development-plan', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.goal) {
      res.status(400).json({ ok: false, error: 'Мета обов’язкова' });
      return;
    }
    const item = await db.createDevelopmentPlanItem({ ...body, employee_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, item });
  } catch (error) {
    console.error('POST /api/employees/:id/development-plan ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/development-plan/:id', requireRole(), async (req, res) => {
  try {
    const item = await db.updateDevelopmentPlanItem(Number(req.params.id), req.body || {});
    if (!item) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, item });
  } catch (error) {
    console.error('POST /api/development-plan/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

// ---- Knowledge Base: articles ----

app.get('/api/kb-articles', async (req, res) => {
  try {
    const { category, audience_type, search } = req.query;
    const articles = await db.listKbArticles({ category: category || '', audience_type: audience_type || '', search: search || '' });
    res.json({ ok: true, articles });
  } catch (error) {
    console.error('GET /api/kb-articles ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати статті' });
  }
});

app.get('/api/kb-articles/:id', async (req, res) => {
  try {
    const article = await db.getKbArticle(Number(req.params.id));
    if (!article) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, article });
  } catch (error) {
    console.error('GET /api/kb-articles/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати статтю' });
  }
});

app.post('/api/kb-articles', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title) {
      res.status(400).json({ ok: false, error: 'Назва обов’язкова' });
      return;
    }
    const article = await db.createKbArticle(body, req.account.username);
    res.json({ ok: true, article });
  } catch (error) {
    console.error('POST /api/kb-articles ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/kb-articles/:id', requireRole(), async (req, res) => {
  try {
    const article = await db.updateKbArticle(Number(req.params.id), req.body || {});
    if (!article) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, article });
  } catch (error) {
    console.error('POST /api/kb-articles/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

app.post('/api/kb-articles/:id/assign-audience', requireRole(), async (req, res) => {
  try {
    const assignments = await db.assignArticleToAudience(Number(req.params.id), req.account.username);
    res.json({ ok: true, assignments });
  } catch (error) {
    console.error('POST /api/kb-articles/:id/assign-audience ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося призначити' });
  }
});

// ---- Knowledge Base: per-employee assignments ----

app.get('/api/employees/:id/kb-assignments', async (req, res) => {
  try {
    const assignments = await db.listKbAssignmentsForEmployee(Number(req.params.id));
    res.json({ ok: true, assignments });
  } catch (error) {
    console.error('GET /api/employees/:id/kb-assignments ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати' });
  }
});

app.post('/api/employees/:id/kb-assignments', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.article_id) {
      res.status(400).json({ ok: false, error: 'Стаття обов’язкова' });
      return;
    }
    const assignment = await db.assignKbArticle({ ...body, employee_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, assignment });
  } catch (error) {
    console.error('POST /api/employees/:id/kb-assignments ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося призначити' });
  }
});

app.post('/api/kb-assignments/:id/acknowledge', requireRole(), async (req, res) => {
  try {
    const assignment = await db.acknowledgeKbAssignment(Number(req.params.id));
    if (!assignment) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, assignment });
  } catch (error) {
    console.error('POST /api/kb-assignments/:id/acknowledge ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося підтвердити' });
  }
});

// ---- Learning Paths ----

app.get('/api/learning-paths', async (req, res) => {
  try {
    const department_id = req.query.department_id ? Number(req.query.department_id) : null;
    const position_id = req.query.position_id ? Number(req.query.position_id) : null;
    const paths = await db.listLearningPaths({ department_id, position_id });
    res.json({ ok: true, paths });
  } catch (error) {
    console.error('GET /api/learning-paths ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати навчальні шляхи' });
  }
});

app.get('/api/learning-paths/:id', async (req, res) => {
  try {
    const path = await db.getLearningPath(Number(req.params.id));
    if (!path) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, path });
  } catch (error) {
    console.error('GET /api/learning-paths/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати' });
  }
});

app.post('/api/learning-paths', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.scope) {
      res.status(400).json({ ok: false, error: 'Назва і область обов’язкові' });
      return;
    }
    const path = await db.createLearningPath(body, req.account.username);
    res.json({ ok: true, path });
  } catch (error) {
    console.error('POST /api/learning-paths ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/learning-paths/:id', requireRole(), async (req, res) => {
  try {
    const path = await db.updateLearningPath(Number(req.params.id), req.body || {});
    if (!path) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, path });
  } catch (error) {
    console.error('POST /api/learning-paths/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

app.post('/api/learning-paths/:id/items', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title) {
      res.status(400).json({ ok: false, error: 'Назва обов’язкова' });
      return;
    }
    const item = await db.addLearningPathItem({ ...body, learning_path_id: Number(req.params.id) });
    res.json({ ok: true, item });
  } catch (error) {
    console.error('POST /api/learning-paths/:id/items ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося додати' });
  }
});

// ---- Learning assignments (per employee) ----

app.get('/api/employees/:id/learning-assignments', async (req, res) => {
  try {
    const assignments = await db.listLearningAssignmentsForEmployee(Number(req.params.id));
    res.json({ ok: true, assignments });
  } catch (error) {
    console.error('GET /api/employees/:id/learning-assignments ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати' });
  }
});

app.post('/api/employees/:id/learning-assignments/generate', requireRole(), async (req, res) => {
  try {
    const employee = await db.getEmployee(Number(req.params.id));
    if (!employee) {
      res.status(404).json({ ok: false, error: 'Співробітника не знайдено' });
      return;
    }
    const cur = employee.current_period;
    const assignments = await db.generateLearningAssignments(employee.id, {
      department_id: cur?.department_id || null,
      position_id: cur?.position_id || null
    }, req.account.username);
    res.json({ ok: true, assignments });
  } catch (error) {
    console.error('POST /api/employees/:id/learning-assignments/generate ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося згенерувати' });
  }
});

app.get('/api/learning-assignments/:id', async (req, res) => {
  try {
    const assignment = await db.getLearningAssignment(Number(req.params.id));
    if (!assignment) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, assignment });
  } catch (error) {
    console.error('GET /api/learning-assignments/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати' });
  }
});

app.post('/api/learning-assignments/:id/items/:itemId/complete', requireRole(), async (req, res) => {
  try {
    const assignment = await db.markLearningItemComplete(Number(req.params.id), Number(req.params.itemId));
    res.json({ ok: true, assignment });
  } catch (error) {
    console.error('POST /api/learning-assignments/:id/items/:itemId/complete ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

app.post('/api/learning-assignments/:id/complete', requireRole(), async (req, res) => {
  try {
    const assignment = await db.completeLearningAssignment(Number(req.params.id), req.body || {});
    if (!assignment) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, assignment });
  } catch (error) {
    console.error('POST /api/learning-assignments/:id/complete ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося завершити' });
  }
});

// ---- Surveys & Engagement ----

app.get('/api/surveys', async (req, res) => {
  try {
    const { type, status } = req.query;
    const surveys = await db.listSurveys({ type: type || '', status: status || '' });
    res.json({ ok: true, surveys });
  } catch (error) {
    console.error('GET /api/surveys ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати опитування' });
  }
});

app.get('/api/surveys/:id', async (req, res) => {
  try {
    const survey = await db.getSurvey(Number(req.params.id));
    if (!survey) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, survey });
  } catch (error) {
    console.error('GET /api/surveys/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати' });
  }
});

app.get('/api/surveys/:id/results', async (req, res) => {
  try {
    const results = await db.getSurveyResults(Number(req.params.id));
    if (!results) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, results });
  } catch (error) {
    console.error('GET /api/surveys/:id/results ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати результати' });
  }
});

app.post('/api/surveys', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.type) {
      res.status(400).json({ ok: false, error: 'Назва і тип обов’язкові' });
      return;
    }
    const survey = await db.createSurvey(body, req.account.username);
    res.json({ ok: true, survey });
  } catch (error) {
    console.error('POST /api/surveys ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/surveys/:id/status', requireRole(), async (req, res) => {
  try {
    const survey = await db.updateSurveyStatus(Number(req.params.id), (req.body || {}).status);
    if (!survey) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, survey });
  } catch (error) {
    console.error('POST /api/surveys/:id/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

app.post('/api/surveys/:id/questions', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.question_text || !body.question_type) {
      res.status(400).json({ ok: false, error: 'Текст питання і тип обов’язкові' });
      return;
    }
    const question = await db.addSurveyQuestion({ ...body, survey_id: Number(req.params.id) });
    res.json({ ok: true, question });
  } catch (error) {
    console.error('POST /api/surveys/:id/questions ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося додати' });
  }
});

app.post('/api/surveys/:id/invite', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    const invitations = body.all
      ? await db.inviteAllActiveEmployees(Number(req.params.id))
      : await db.inviteEmployees(Number(req.params.id), body.employee_ids || []);
    res.json({ ok: true, invitations });
  } catch (error) {
    console.error('POST /api/surveys/:id/invite ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося запросити' });
  }
});

app.post('/api/surveys/:id/responses', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.employee_id) {
      res.status(400).json({ ok: false, error: 'Співробітник обов’язковий' });
      return;
    }
    const response = await db.submitSurveyResponse({ ...body, survey_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, response });
  } catch (error) {
    console.error('POST /api/surveys/:id/responses ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти відповідь' });
  }
});

// ---- HR Operations: absences ----

app.get('/api/absences', async (req, res) => {
  try {
    const { status, from, to } = req.query;
    const employee_id = req.query.employee_id ? Number(req.query.employee_id) : null;
    const department_id = req.query.department_id ? Number(req.query.department_id) : null;
    const absences = await db.listAbsences({ employee_id, department_id, status: status || '', from: from || '', to: to || '' });
    res.json({ ok: true, absences });
  } catch (error) {
    console.error('GET /api/absences ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати відсутності' });
  }
});

app.post('/api/absences', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.employee_id || !body.type || !body.start_date || !body.end_date) {
      res.status(400).json({ ok: false, error: 'Співробітник, тип і дати обов’язкові' });
      return;
    }
    const absence = await db.createAbsence(body, req.account.username);
    res.json({ ok: true, absence });
  } catch (error) {
    console.error('POST /api/absences ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося створити' });
  }
});

app.post('/api/absences/:id/status', requireRole(), async (req, res) => {
  try {
    const { status, approver_username } = req.body || {};
    const absence = await db.updateAbsenceStatus(Number(req.params.id), status, approver_username, req.account.username);
    if (!absence) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, absence });
  } catch (error) {
    console.error('POST /api/absences/:id/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

app.post('/api/absences/:id', requireRole(), async (req, res) => {
  try {
    const absence = await db.updateAbsence(Number(req.params.id), req.body || {});
    if (!absence) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, absence });
  } catch (error) {
    console.error('POST /api/absences/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

// ---- Offboarding ----

app.get('/api/offboarding-cases', async (req, res) => {
  try {
    const { status } = req.query;
    const cases = await db.listOffboardingCases({ status: status || '' });
    res.json({ ok: true, cases });
  } catch (error) {
    console.error('GET /api/offboarding-cases ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати' });
  }
});

app.get('/api/employees/:id/offboarding-cases', async (req, res) => {
  try {
    const cases = await db.getOffboardingCasesForEmployee(Number(req.params.id));
    res.json({ ok: true, cases });
  } catch (error) {
    console.error('GET /api/employees/:id/offboarding-cases ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати' });
  }
});

app.get('/api/offboarding-cases/:id', async (req, res) => {
  try {
    const offboardingCase = await db.getOffboardingCase(Number(req.params.id));
    if (!offboardingCase) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, case: offboardingCase });
  } catch (error) {
    console.error('GET /api/offboarding-cases/:id ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати' });
  }
});

app.post('/api/employees/:id/offboarding-cases', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.initiation_type) {
      res.status(400).json({ ok: false, error: 'Тип ініціації обов’язковий' });
      return;
    }
    const offboardingCase = await db.initiateOffboarding({ ...body, employee_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, case: offboardingCase });
  } catch (error) {
    console.error('POST /api/employees/:id/offboarding-cases ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося ініціювати звільнення' });
  }
});

app.post('/api/offboarding-cases/:id', requireRole(), async (req, res) => {
  try {
    const offboardingCase = await db.updateOffboardingCase(Number(req.params.id), req.body || {});
    if (!offboardingCase) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, case: offboardingCase });
  } catch (error) {
    console.error('POST /api/offboarding-cases/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

app.post('/api/offboarding-cases/:id/status', requireRole(), async (req, res) => {
  try {
    const offboardingCase = await db.updateOffboardingCaseStatus(Number(req.params.id), (req.body || {}).status, req.account.username);
    if (!offboardingCase) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, case: offboardingCase });
  } catch (error) {
    console.error('POST /api/offboarding-cases/:id/status ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося змінити статус' });
  }
});

app.post('/api/offboarding-cases/:id/checklist', requireRole(), async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.category) {
      res.status(400).json({ ok: false, error: 'Назва і категорія обов’язкові' });
      return;
    }
    const item = await db.addOffboardingChecklistItem({ ...body, case_id: Number(req.params.id) });
    res.json({ ok: true, item });
  } catch (error) {
    console.error('POST /api/offboarding-cases/:id/checklist ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося додати' });
  }
});

app.post('/api/offboarding-checklist/:id', requireRole(), async (req, res) => {
  try {
    const item = await db.updateOffboardingChecklistItem(Number(req.params.id), req.body || {});
    if (!item) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, item });
  } catch (error) {
    console.error('POST /api/offboarding-checklist/:id ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося оновити' });
  }
});

app.post('/api/offboarding-cases/:id/exit-interview', requireRole(), async (req, res) => {
  try {
    const exitInterview = await db.upsertExitInterview({ ...(req.body || {}), case_id: Number(req.params.id) }, req.account.username);
    res.json({ ok: true, exitInterview });
  } catch (error) {
    console.error('POST /api/offboarding-cases/:id/exit-interview ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося зберегти' });
  }
});

app.post('/api/offboarding-cases/:id/close', requireRole(), async (req, res) => {
  try {
    const offboardingCase = await db.closeOffboardingCase(Number(req.params.id), req.account.username);
    if (!offboardingCase) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.json({ ok: true, case: offboardingCase });
  } catch (error) {
    console.error('POST /api/offboarding-cases/:id/close ERROR:', error?.message || error);
    res.status(400).json({ ok: false, error: error?.message || 'Не вдалося завершити' });
  }
});

// ---- Resume upload & parsing (ТЗ п.11) ----

app.post('/api/candidates/:id/resumes', requireRole('Recruiter'), async (req, res) => {
  try {
    await uploadSingleFile(req, res);
    if (!req.file) {
      res.status(400).json({ ok: false, error: 'Файл обов’язковий' });
      return;
    }
    const resume = await db.addResumeToCandidate(
      Number(req.params.id),
      { buffer: req.file.buffer, filename: req.file.originalname, mimeType: req.file.mimetype },
      req.account.username
    );
    res.json({ ok: true, resume });
  } catch (error) {
    console.error('POST /api/candidates/:id/resumes ERROR:', error?.message || error);
    const message = error?.message?.includes('File too large') ? 'Файл завеликий (максимум 15МБ)' : (error?.message || 'Не вдалося завантажити резюме');
    res.status(400).json({ ok: false, error: message });
  }
});

app.get('/api/candidates/:id/resumes', async (req, res) => {
  try {
    const resumes = await db.listResumesForCandidate(Number(req.params.id));
    res.json({ ok: true, resumes });
  } catch (error) {
    console.error('GET /api/candidates/:id/resumes ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося отримати резюме' });
  }
});

app.get('/api/resumes/:id/download', async (req, res) => {
  try {
    const file = await db.getResumeFile(Number(req.params.id));
    if (!file) {
      res.status(404).json({ ok: false, error: 'Не знайдено' });
      return;
    }
    res.set('Content-Type', file.mime_type || 'application/octet-stream');
    res.set('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    res.send(file.file_data);
  } catch (error) {
    console.error('GET /api/resumes/:id/download ERROR:', error?.message || error);
    res.status(500).json({ ok: false, error: 'Не вдалося завантажити файл' });
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
