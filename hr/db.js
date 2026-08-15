import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// HRD = повний доступ до всього (аналог "адмін" у ERP виробництва). Інші
// ролі з ТЗ (Recruiter, Hiring Manager, Department Manager, Mentor/Buddy,
// Financial Manager, Custom Role) стосуються модулів Release 1, яких у
// цьому першому зрізі (Employee Master Data + Org Structure) ще немає —
// поле role лишається розширюваним, але реально розмежовує права поки
// лише HRD/не-HRD.
const ACCOUNT_ROLES = ['HRD', 'Manager', 'Employee'];
const SESSION_IDLE_MINUTES = 60;

const EMPLOYEE_STATUSES = [
  'Future Employee', 'Probation', 'Active', 'Part-time',
  'Maternity/Parental Leave', 'Suspended', 'Long Absence', 'Leaving', 'Former Employee'
];
const POSITION_STATUSES = ['Filled', 'Vacant', 'Recruitment Active', 'Planned', 'Frozen', 'Closed'];
const RESERVATION_STATUSES = ['Not Reserved', 'In Progress', 'Reserved', 'Expiring', 'Other'];

// Recruitment / ATS (ТЗ розділи 9-19)
const VACANCY_REQUEST_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Converted to Vacancy', 'Cancelled'];
const VACANCY_STATUSES = ['Open', 'On Hold', 'Filled', 'Cancelled', 'Closed'];
const APPLICATION_STAGES = ['New Candidate', 'Screening', 'Interview', 'Test Task', 'Reference Check', 'Offer', 'Hired'];
const APPLICATION_STATUSES = ['Active', 'Rejected', 'Withdrawn', 'Hired'];
const REJECTION_REASONS_COMPANY = ['Недостатньо досвіду', 'Не підходить за компетенціями', 'Не пройшов тестове завдання', 'Завищені зарплатні очікування', 'Не підходить за soft skills', 'Вакансію закрито/заморожено', 'Інше'];
const REJECTION_REASONS_CANDIDATE = ['Прийняв іншу пропозицію', 'Не влаштовують умови', 'Не влаштовує зарплата', 'Змінив рішення щодо пошуку роботи', 'Не виходить на зв`язок', 'Інше'];
const OFFER_STATUSES = ['Draft', 'Sent', 'Accepted', 'Declined', 'Expired', 'Withdrawn'];
const INTERVIEW_TYPES = ['HR Screening', 'Technical/Professional', 'Final', 'Test Task Review', 'Reference Check'];
const INTERVIEW_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'No Show'];

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hr_accounts (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS hr_sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL REFERENCES hr_accounts(username),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_sessions_last_seen ON hr_sessions(last_seen_at);

    -- Organization Structure: департаменти з ієрархією (батьківський
    -- департамент — напр. "Виробництво" батько для "Обсмажка"/"Пакування").
    CREATE TABLE IF NOT EXISTS hr_departments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      parent_department_id INTEGER REFERENCES hr_departments(id),
      planned_headcount INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_departments_parent ON hr_departments(parent_department_id);

    -- Position — конкретна штатна одиниця ("посадова одиниця"), а не просто
    -- назва посади: одна и та ж назва ("Продавець-консультант") — кілька
    -- рядків Position, якщо потрібно кілька одиниць. reports_to_position_id
    -- задає лінію підпорядкування для org chart незалежно від того, хто
    -- конкретно зараз цю посаду займає.
    CREATE TABLE IF NOT EXISTS hr_positions (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      department_id INTEGER NOT NULL REFERENCES hr_departments(id),
      reports_to_position_id INTEGER REFERENCES hr_positions(id),
      status TEXT NOT NULL DEFAULT 'Vacant',
      is_department_head BOOLEAN NOT NULL DEFAULT false,
      note TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_positions_department ON hr_positions(department_id);
    CREATE INDEX IF NOT EXISTS idx_hr_positions_reports_to ON hr_positions(reports_to_position_id);

    -- Person = "one person — one master record" (ТЗ п.3). У Release 1 ще
    -- немає Candidate/Recruitment — Person тут завжди веде до одного
    -- Employee, але таблиця виділена окремо, щоб рекрутинг (коли дійде
    -- черга) міг додати Candidate-профіль до того самого Person без
    -- дублювання людини.
    CREATE TABLE IF NOT EXISTS hr_persons (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      birth_date DATE,
      gender TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      personal_email TEXT NOT NULL DEFAULT '',
      telegram TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      emergency_contact TEXT NOT NULL DEFAULT '',
      photo_url TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS hr_employees (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL UNIQUE REFERENCES hr_persons(id),
      employee_number TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'Future Employee',
      corporate_email TEXT NOT NULL DEFAULT '',
      first_hire_date DATE,
      rehire_eligible BOOLEAN,
      -- Бронювання/військовий статус (ТЗ 21.3) — чутливе поле, окремо
      -- позначене в API/UI як restricted (field-level permission поки
      -- спрощено до ролі HRD, як і решта чутливих полів у цьому зрізі).
      reservation_applicable TEXT NOT NULL DEFAULT 'Not applicable',
      reservation_status TEXT NOT NULL DEFAULT '',
      reservation_start_date DATE,
      reservation_end_date DATE,
      reservation_comment TEXT NOT NULL DEFAULT '',
      reservation_document_url TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_employees_status ON hr_employees(status);

    -- Employment Period: кожна зміна посади/департаменту/керівника —
    -- НОВИЙ рядок (закриває попередній end_date), а не перезапис (ТЗ п.3
    -- "No silent overwrites"). Це водночас і поточне працевлаштування
    -- (end_date IS NULL), і повна історія змін для вкладки Changes.
    CREATE TABLE IF NOT EXISTS hr_employment_periods (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      position_id INTEGER NOT NULL REFERENCES hr_positions(id),
      department_id INTEGER NOT NULL REFERENCES hr_departments(id),
      manager_employee_id INTEGER REFERENCES hr_employees(id),
      start_date DATE NOT NULL,
      end_date DATE,
      employment_type TEXT NOT NULL DEFAULT '',
      employment_format TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      change_reason TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_employment_periods_employee ON hr_employment_periods(employee_id);
    CREATE INDEX IF NOT EXISTS idx_hr_employment_periods_current ON hr_employment_periods(employee_id) WHERE end_date IS NULL;

    -- Compensation: кожна зміна — окремий effective-dated запис, ніколи не
    -- перезаписується (ТЗ п.22).
    CREATE TABLE IF NOT EXISTS hr_compensation_records (
      id SERIAL PRIMARY KEY,
      employee_id INTEGER NOT NULL REFERENCES hr_employees(id),
      effective_from DATE NOT NULL,
      effective_to DATE,
      fixed_salary NUMERIC,
      currency TEXT NOT NULL DEFAULT 'UAH',
      bonus_type TEXT NOT NULL DEFAULT '',
      bonus_formula TEXT NOT NULL DEFAULT '',
      kpi_bonus TEXT NOT NULL DEFAULT '',
      additional_payments TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      document_url TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      approved_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_compensation_employee ON hr_compensation_records(employee_id);

    -- ==================== Recruitment / ATS (ТЗ розділи 9-19) ====================

    -- Vacancy Request: погодження потреби ще ДО того, як існує вакансія
    -- (ТЗ 9.1/9.2) — керівник ініціює, HRD фінально погоджує, потім
    -- окрема дія "Convert to Vacancy" (не автоматично на Approved).
    CREATE TABLE IF NOT EXISTS hr_vacancy_requests (
      id SERIAL PRIMARY KEY,
      position_title TEXT NOT NULL,
      department_id INTEGER NOT NULL REFERENCES hr_departments(id),
      hiring_manager_employee_id INTEGER REFERENCES hr_employees(id),
      request_reason TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      priority TEXT NOT NULL DEFAULT '',
      desired_start_date DATE,
      ideal_candidate_portrait TEXT NOT NULL DEFAULT '',
      responsibilities TEXT NOT NULL DEFAULT '',
      skills_professional TEXT NOT NULL DEFAULT '',
      skills_technical TEXT NOT NULL DEFAULT '',
      skills_additional TEXT NOT NULL DEFAULT '',
      product_knowledge TEXT NOT NULL DEFAULT '',
      personal_qualities_required TEXT NOT NULL DEFAULT '',
      personal_qualities_desired TEXT NOT NULL DEFAULT '',
      compensation_trial TEXT NOT NULL DEFAULT '',
      compensation_probation TEXT NOT NULL DEFAULT '',
      compensation_after_probation TEXT NOT NULL DEFAULT '',
      compensation_bonus_formula TEXT NOT NULL DEFAULT '',
      probation_goals TEXT NOT NULL DEFAULT '',
      career_growth TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Draft',
      status_note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_vacancy_requests_status ON hr_vacancy_requests(status);

    CREATE TABLE IF NOT EXISTS hr_vacancies (
      id SERIAL PRIMARY KEY,
      vacancy_request_id INTEGER REFERENCES hr_vacancy_requests(id),
      position_id INTEGER REFERENCES hr_positions(id),
      department_id INTEGER NOT NULL REFERENCES hr_departments(id),
      hiring_manager_employee_id INTEGER REFERENCES hr_employees(id),
      recruiter_username TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Open',
      priority TEXT NOT NULL DEFAULT '',
      target_date DATE,
      profile_snapshot TEXT NOT NULL DEFAULT '',
      override_reason TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_vacancies_status ON hr_vacancies(status);

    -- Candidate = hr_persons профіль + рекрутингові поля (ТЗ п.3 "one
    -- person — one master record", п.10 Candidate/Application). Той самий
    -- person_id пізніше стає hr_employees при Offer Accepted — не
    -- дублюється.
    CREATE TABLE IF NOT EXISTS hr_candidates (
      id SERIAL PRIMARY KEY,
      person_id INTEGER NOT NULL UNIQUE REFERENCES hr_persons(id),
      current_job_title TEXT NOT NULL DEFAULT '',
      desired_role TEXT NOT NULL DEFAULT '',
      desired_salary TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      owner_recruiter TEXT NOT NULL DEFAULT '',
      resume_url TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      talent_pool_segment TEXT NOT NULL DEFAULT '',
      talent_pool_category TEXT NOT NULL DEFAULT '',
      talent_pool_next_contact DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Application: Candidate ↔ Vacancy (не сам Candidate — той самий
    -- кандидат може мати кілька заявок одночасно, ТЗ п.10).
    CREATE TABLE IF NOT EXISTS hr_applications (
      id SERIAL PRIMARY KEY,
      candidate_id INTEGER NOT NULL REFERENCES hr_candidates(id),
      vacancy_id INTEGER NOT NULL REFERENCES hr_vacancies(id),
      stage TEXT NOT NULL DEFAULT 'New Candidate',
      status TEXT NOT NULL DEFAULT 'Active',
      rejection_reason TEXT NOT NULL DEFAULT '',
      rejection_comment TEXT NOT NULL DEFAULT '',
      applied_date DATE NOT NULL DEFAULT CURRENT_DATE,
      next_action TEXT NOT NULL DEFAULT '',
      next_action_date DATE,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (candidate_id, vacancy_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hr_applications_vacancy ON hr_applications(vacancy_id);
    CREATE INDEX IF NOT EXISTS idx_hr_applications_candidate ON hr_applications(candidate_id);

    -- Interview: спрощено на цьому зрізі — дата/тип/нотатки/рішення, без
    -- формального зваженого scorecard-шаблону (ТЗ п.16 Scorecard templates
    -- — наступний крок) і без Google Calendar sync.
    CREATE TABLE IF NOT EXISTS hr_interviews (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES hr_applications(id),
      interview_type TEXT NOT NULL DEFAULT '',
      scheduled_at TIMESTAMPTZ,
      participants TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Scheduled',
      notes TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_interviews_application ON hr_interviews(application_id);

    -- Offer: Accepted створює Future Employee РІВНО ОДИН РАЗ (employee_id
    -- фіксує це — ТЗ п.37 idempotent).
    CREATE TABLE IF NOT EXISTS hr_offers (
      id SERIAL PRIMARY KEY,
      application_id INTEGER NOT NULL REFERENCES hr_applications(id),
      fixed_salary NUMERIC,
      currency TEXT NOT NULL DEFAULT 'UAH',
      bonus_formula TEXT NOT NULL DEFAULT '',
      kpi_bonus TEXT NOT NULL DEFAULT '',
      start_date DATE,
      probation_goals TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Draft',
      acceptance_deadline DATE,
      employee_id INTEGER REFERENCES hr_employees(id),
      created_by TEXT NOT NULL DEFAULT '',
      approved_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_offers_application ON hr_offers(application_id);

    -- Audit Log: хто/що/коли для чутливих змін (статус, компенсація,
    -- працевлаштування) — ТЗ п.3 Auditability і п.39 Audit.
    CREATE TABLE IF NOT EXISTS hr_audit_log (
      id SERIAL PRIMARY KEY,
      actor TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      old_value JSONB,
      new_value JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_hr_audit_entity ON hr_audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_hr_audit_created ON hr_audit_log(created_at);
  `);
}

// ---------------------------------------------------------------------
// Auth (той самий підхід, що й у warehouse/db.js — окремі акаунти/сесії,
// бо HR CRM і ERP свідомо різні backend-сервіси на цьому етапі; ТЗ п.5
// прямо допускає "SSO-ready", не вимагає єдиного логіна вже в Release 1).
// ---------------------------------------------------------------------

async function createAccountIfMissingWithHash({ username, password_hash, role, display_name }) {
  if (!ACCOUNT_ROLES.includes(role)) {
    throw new Error(`Unknown role: ${role}`);
  }
  const { rowCount } = await pool.query(
    `INSERT INTO hr_accounts (username, password_hash, role, display_name)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (username) DO NOTHING`,
    [username, password_hash, role, display_name || '']
  );
  return rowCount;
}

async function findAccountByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM hr_accounts WHERE username = $1 AND active = true', [username]);
  return rows[0] || null;
}

async function verifyAccountPassword(account, password) {
  return bcrypt.compare(password, account.password_hash);
}

async function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO hr_sessions (token, username) VALUES ($1, $2)', [token, username]);
  return token;
}

async function touchSession(token) {
  const { rows } = await pool.query(
    `UPDATE hr_sessions SET last_seen_at = now()
     WHERE token = $1 AND last_seen_at > now() - interval '${SESSION_IDLE_MINUTES} minutes'
     RETURNING username`,
    [token]
  );
  return rows[0]?.username || null;
}

async function deleteSession(token) {
  await pool.query('DELETE FROM hr_sessions WHERE token = $1', [token]);
}

async function cleanupExpiredSessions() {
  const { rowCount } = await pool.query(
    `DELETE FROM hr_sessions WHERE last_seen_at < now() - interval '${SESSION_IDLE_MINUTES} minutes'`
  );
  return rowCount;
}

// ---------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------

async function writeAudit({ actor, action, entity_type, entity_id, old_value, new_value }) {
  await pool.query(
    `INSERT INTO hr_audit_log (actor, action, entity_type, entity_id, old_value, new_value)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [actor || '', action, entity_type, entity_id ?? null, old_value ? JSON.stringify(old_value) : null, new_value ? JSON.stringify(new_value) : null]
  );
}

async function listAuditLog({ entity_type = '', entity_id = null, limit = 100 } = {}) {
  const conditions = [];
  const params = [];
  if (entity_type) {
    params.push(entity_type);
    conditions.push(`entity_type = $${params.length}`);
  }
  if (entity_id) {
    params.push(entity_id);
    conditions.push(`entity_id = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT * FROM hr_audit_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------

async function listDepartments() {
  const { rows } = await pool.query(`
    SELECT d.*,
      (SELECT COUNT(*)::int FROM hr_positions p WHERE p.department_id = d.id AND p.active = true) AS position_count,
      (SELECT COUNT(*)::int FROM hr_positions p
         JOIN hr_employment_periods ep ON ep.position_id = p.id AND ep.end_date IS NULL
        WHERE p.department_id = d.id AND p.active = true) AS filled_count
    FROM hr_departments d
    WHERE d.active = true
    ORDER BY lower(d.name) ASC
  `);
  return rows;
}

async function createDepartment({ name, parent_department_id, planned_headcount }) {
  const { rows } = await pool.query(
    `INSERT INTO hr_departments (name, parent_department_id, planned_headcount)
     VALUES ($1,$2,$3) RETURNING *`,
    [name, parent_department_id || null, planned_headcount || 0]
  );
  return rows[0];
}

async function updateDepartment(id, { name, parent_department_id, planned_headcount, active }) {
  if (parent_department_id && Number(parent_department_id) === Number(id)) {
    throw new Error('Департамент не може бути власним батьківським');
  }
  const { rows } = await pool.query(
    `UPDATE hr_departments SET
       name = COALESCE($2, name),
       parent_department_id = $3,
       planned_headcount = COALESCE($4, planned_headcount),
       active = COALESCE($5, active),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, name ?? null, parent_department_id ?? null, planned_headcount ?? null, active ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------

async function listPositions({ department_id = null } = {}) {
  const conditions = [`p.active = true`];
  const params = [];
  if (department_id) {
    params.push(department_id);
    conditions.push(`p.department_id = $${params.length}`);
  }
  const { rows } = await pool.query(`
    SELECT p.*, d.name AS department_name, rp.title AS reports_to_title,
      ep.employee_id AS current_employee_id, per.full_name AS current_employee_name
    FROM hr_positions p
    JOIN hr_departments d ON d.id = p.department_id
    LEFT JOIN hr_positions rp ON rp.id = p.reports_to_position_id
    LEFT JOIN hr_employment_periods ep ON ep.position_id = p.id AND ep.end_date IS NULL
    LEFT JOIN hr_employees emp ON emp.id = ep.employee_id
    LEFT JOIN hr_persons per ON per.id = emp.person_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY lower(d.name) ASC, lower(p.title) ASC
  `, params);
  return rows;
}

async function createPosition({ title, department_id, reports_to_position_id, status, is_department_head, note }) {
  if (status && !POSITION_STATUSES.includes(status)) {
    throw new Error(`Unknown position status: ${status}`);
  }
  const { rows } = await pool.query(
    `INSERT INTO hr_positions (title, department_id, reports_to_position_id, status, is_department_head, note)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [title, department_id, reports_to_position_id || null, status || 'Vacant', !!is_department_head, note || '']
  );
  return rows[0];
}

async function updatePosition(id, { title, department_id, reports_to_position_id, status, is_department_head, note, active }) {
  if (status && !POSITION_STATUSES.includes(status)) {
    throw new Error(`Unknown position status: ${status}`);
  }
  if (reports_to_position_id && Number(reports_to_position_id) === Number(id)) {
    throw new Error('Посада не може підпорядковуватись сама собі');
  }
  const { rows } = await pool.query(
    `UPDATE hr_positions SET
       title = COALESCE($2, title),
       department_id = COALESCE($3, department_id),
       reports_to_position_id = $4,
       status = COALESCE($5, status),
       is_department_head = COALESCE($6, is_department_head),
       note = COALESCE($7, note),
       active = COALESCE($8, active),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, title ?? null, department_id ?? null, reports_to_position_id ?? null, status ?? null, is_department_head ?? null, note ?? null, active ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// People (Person + Employee)
// ---------------------------------------------------------------------

function humanTenure(startDate) {
  if (!startDate) return '';
  const start = new Date(startDate);
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return '';
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? 'рік' : years < 5 ? 'роки' : 'років'}`);
  if (remMonths > 0 || years === 0) parts.push(`${remMonths} міс.`);
  return parts.join(' ');
}

async function listEmployees({ search = '', status = '', department_id = null } = {}) {
  const conditions = [`e.active = true`];
  const params = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(per.full_name) LIKE $${params.length} OR lower(e.employee_number) LIKE $${params.length} OR lower(per.phone) LIKE $${params.length} OR lower(per.personal_email) LIKE $${params.length})`);
  }
  if (status) {
    params.push(status);
    conditions.push(`e.status = $${params.length}`);
  }
  if (department_id) {
    params.push(department_id);
    conditions.push(`ep.department_id = $${params.length}`);
  }
  const { rows } = await pool.query(`
    SELECT e.*, per.full_name, per.birth_date, per.phone, per.personal_email, per.telegram, per.photo_url,
      pos.title AS position_title, dep.name AS department_name, dep.id AS department_id,
      mgr_per.full_name AS manager_name,
      ep.start_date AS employment_start_date
    FROM hr_employees e
    JOIN hr_persons per ON per.id = e.person_id
    LEFT JOIN hr_employment_periods ep ON ep.employee_id = e.id AND ep.end_date IS NULL
    LEFT JOIN hr_positions pos ON pos.id = ep.position_id
    LEFT JOIN hr_departments dep ON dep.id = ep.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = ep.manager_employee_id
    LEFT JOIN hr_persons mgr_per ON mgr_per.id = mgr.person_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY lower(per.full_name) ASC
  `, params);
  return rows.map((r) => ({ ...r, tenure: humanTenure(r.employment_start_date || r.first_hire_date) }));
}

async function getEmployee(id) {
  const { rows } = await pool.query(`
    SELECT e.*, per.*, e.id AS id, e.created_at AS created_at
    FROM hr_employees e
    JOIN hr_persons per ON per.id = e.person_id
    WHERE e.id = $1
  `, [id]);
  const employee = rows[0];
  if (!employee) return null;

  const { rows: periods } = await pool.query(`
    SELECT ep.*, pos.title AS position_title, dep.name AS department_name, mgr_per.full_name AS manager_name
    FROM hr_employment_periods ep
    JOIN hr_positions pos ON pos.id = ep.position_id
    JOIN hr_departments dep ON dep.id = ep.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = ep.manager_employee_id
    LEFT JOIN hr_persons mgr_per ON mgr_per.id = mgr.person_id
    WHERE ep.employee_id = $1
    ORDER BY ep.start_date DESC, ep.id DESC
  `, [id]);

  const { rows: compensation } = await pool.query(`
    SELECT * FROM hr_compensation_records WHERE employee_id = $1 ORDER BY effective_from DESC, id DESC
  `, [id]);

  const current = periods.find((p) => !p.end_date) || null;

  return {
    ...employee,
    tenure: humanTenure(current?.start_date || employee.first_hire_date),
    current_period: current,
    employment_periods: periods,
    compensation_records: compensation
  };
}

async function createEmployee({ full_name, birth_date, gender, phone, personal_email, telegram, city,
  emergency_contact, employee_number, status, corporate_email, first_hire_date,
  position_id, department_id, manager_employee_id, start_date, employment_type, employment_format, location,
  created_by }) {
  if (status && !EMPLOYEE_STATUSES.includes(status)) {
    throw new Error(`Unknown employee status: ${status}`);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: personRows } = await client.query(
      `INSERT INTO hr_persons (full_name, birth_date, gender, phone, personal_email, telegram, city, emergency_contact)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [full_name, birth_date || null, gender || '', phone || '', personal_email || '', telegram || '', city || '', emergency_contact || '']
    );
    const person = personRows[0];

    const { rows: empRows } = await client.query(
      `INSERT INTO hr_employees (person_id, employee_number, status, corporate_email, first_hire_date)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [person.id, employee_number || null, status || 'Future Employee', corporate_email || '', first_hire_date || start_date || null]
    );
    const employee = empRows[0];

    if (position_id && department_id && start_date) {
      await client.query(
        `INSERT INTO hr_employment_periods (employee_id, position_id, department_id, manager_employee_id, start_date, employment_type, employment_format, location, change_reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Прийняття на роботу',$9)`,
        [employee.id, position_id, department_id, manager_employee_id || null, start_date, employment_type || '', employment_format || '', location || '', created_by || '']
      );
      await client.query(`UPDATE hr_positions SET status = 'Filled', updated_at = now() WHERE id = $1`, [position_id]);
    }

    await client.query('COMMIT');
    await writeAudit({ actor: created_by, action: 'create', entity_type: 'employee', entity_id: employee.id, new_value: { full_name, status: employee.status } });
    return employee;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updatePersonFields(personId, fields) {
  const { full_name, birth_date, gender, phone, personal_email, telegram, city, emergency_contact, photo_url } = fields;
  const { rows } = await pool.query(
    `UPDATE hr_persons SET
       full_name = COALESCE($2, full_name),
       birth_date = $3,
       gender = COALESCE($4, gender),
       phone = COALESCE($5, phone),
       personal_email = COALESCE($6, personal_email),
       telegram = COALESCE($7, telegram),
       city = COALESCE($8, city),
       emergency_contact = COALESCE($9, emergency_contact),
       photo_url = COALESCE($10, photo_url),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [personId, full_name ?? null, birth_date ?? null, gender ?? null, phone ?? null, personal_email ?? null,
      telegram ?? null, city ?? null, emergency_contact ?? null, photo_url ?? null]
  );
  return rows[0] || null;
}

async function updateEmployeeStatus(employeeId, status, actor) {
  if (!EMPLOYEE_STATUSES.includes(status)) {
    throw new Error(`Unknown employee status: ${status}`);
  }
  const { rows: before } = await pool.query('SELECT status FROM hr_employees WHERE id = $1', [employeeId]);
  if (!before[0]) return null;

  const { rows } = await pool.query(
    `UPDATE hr_employees SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [employeeId, status]
  );
  await writeAudit({
    actor, action: 'status_change', entity_type: 'employee', entity_id: employeeId,
    old_value: { status: before[0].status }, new_value: { status }
  });
  return rows[0];
}

async function updateEmployeeFields(employeeId, { employee_number, corporate_email, first_hire_date, rehire_eligible,
  reservation_applicable, reservation_status, reservation_start_date, reservation_end_date, reservation_comment, reservation_document_url }) {
  if (reservation_status && !RESERVATION_STATUSES.includes(reservation_status)) {
    throw new Error(`Unknown reservation status: ${reservation_status}`);
  }
  const { rows } = await pool.query(
    `UPDATE hr_employees SET
       employee_number = COALESCE($2, employee_number),
       corporate_email = COALESCE($3, corporate_email),
       first_hire_date = COALESCE($4, first_hire_date),
       rehire_eligible = COALESCE($5, rehire_eligible),
       reservation_applicable = COALESCE($6, reservation_applicable),
       reservation_status = COALESCE($7, reservation_status),
       reservation_start_date = $8,
       reservation_end_date = $9,
       reservation_comment = COALESCE($10, reservation_comment),
       reservation_document_url = COALESCE($11, reservation_document_url),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [employeeId, employee_number ?? null, corporate_email ?? null, first_hire_date ?? null, rehire_eligible ?? null,
      reservation_applicable ?? null, reservation_status ?? null, reservation_start_date ?? null, reservation_end_date ?? null,
      reservation_comment ?? null, reservation_document_url ?? null]
  );
  return rows[0] || null;
}

// Зміна посади/департаменту/керівника — закриває поточний Employment
// Period (end_date = день перед новим start_date) і створює новий, а не
// перезаписує (ТЗ п.3 No silent overwrites). Стара посада звільняється
// (стає Vacant), якщо на ній не лишилось інших активних періодів.
async function changeEmployment(employeeId, { position_id, department_id, manager_employee_id, start_date,
  employment_type, employment_format, location, change_reason, created_by }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: currentRows } = await client.query(
      `SELECT * FROM hr_employment_periods WHERE employee_id = $1 AND end_date IS NULL FOR UPDATE`,
      [employeeId]
    );
    const current = currentRows[0];

    if (current) {
      const endDate = new Date(start_date);
      endDate.setDate(endDate.getDate() - 1);
      await client.query(
        `UPDATE hr_employment_periods SET end_date = $2 WHERE id = $1`,
        [current.id, endDate.toISOString().slice(0, 10)]
      );
      if (current.position_id !== position_id) {
        const { rows: stillFilled } = await client.query(
          `SELECT 1 FROM hr_employment_periods WHERE position_id = $1 AND end_date IS NULL AND id != $2`,
          [current.position_id, current.id]
        );
        if (stillFilled.length === 0) {
          await client.query(`UPDATE hr_positions SET status = 'Vacant', updated_at = now() WHERE id = $1`, [current.position_id]);
        }
      }
    }

    const { rows: newRows } = await client.query(
      `INSERT INTO hr_employment_periods (employee_id, position_id, department_id, manager_employee_id, start_date, employment_type, employment_format, location, change_reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [employeeId, position_id, department_id, manager_employee_id || null, start_date,
        employment_type || '', employment_format || '', location || '', change_reason || '', created_by || '']
    );
    await client.query(`UPDATE hr_positions SET status = 'Filled', updated_at = now() WHERE id = $1`, [position_id]);

    await client.query('COMMIT');
    await writeAudit({
      actor: created_by, action: 'employment_change', entity_type: 'employee', entity_id: employeeId,
      old_value: current ? { position_id: current.position_id, department_id: current.department_id, manager_employee_id: current.manager_employee_id } : null,
      new_value: { position_id, department_id, manager_employee_id, start_date, change_reason }
    });
    return newRows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Compensation
// ---------------------------------------------------------------------

async function addCompensationRecord({ employee_id, effective_from, fixed_salary, currency, bonus_type,
  bonus_formula, kpi_bonus, additional_payments, reason, comment, document_url, created_by, approved_by }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Попередній відкритий запис логічно закривається днем перед новим
    // effective_from (ТЗ п.22 — "попередній запис має закриватись логічно,
    // без перекриття дат").
    const { rows: openRows } = await client.query(
      `SELECT id FROM hr_compensation_records WHERE employee_id = $1 AND effective_to IS NULL FOR UPDATE`,
      [employee_id]
    );
    if (openRows[0]) {
      const endDate = new Date(effective_from);
      endDate.setDate(endDate.getDate() - 1);
      await client.query(`UPDATE hr_compensation_records SET effective_to = $2 WHERE id = $1`, [openRows[0].id, endDate.toISOString().slice(0, 10)]);
    }

    const { rows } = await client.query(
      `INSERT INTO hr_compensation_records (employee_id, effective_from, fixed_salary, currency, bonus_type, bonus_formula, kpi_bonus, additional_payments, reason, comment, document_url, created_by, approved_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [employee_id, effective_from, fixed_salary || null, currency || 'UAH', bonus_type || '', bonus_formula || '',
        kpi_bonus || '', additional_payments || '', reason || '', comment || '', document_url || '', created_by || '', approved_by || '']
    );
    await client.query('COMMIT');
    await writeAudit({ actor: created_by, action: 'compensation_change', entity_type: 'employee', entity_id: employee_id, new_value: { fixed_salary, reason, effective_from } });
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Org chart (спрощений перший варіант: вкладене дерево департамент → посади
// → хто зараз на посаді, а не графічний drag&drop — Chart View з
// повноцінною візуалізацією лишається наступним кроком)
// ---------------------------------------------------------------------

async function getOrgTree() {
  const departments = await listDepartments();
  const { rows: positions } = await pool.query(`
    SELECT p.*, ep.employee_id AS current_employee_id, per.full_name AS current_employee_name,
      per.photo_url AS current_employee_photo, emp.status AS current_employee_status
    FROM hr_positions p
    LEFT JOIN hr_employment_periods ep ON ep.position_id = p.id AND ep.end_date IS NULL
    LEFT JOIN hr_employees emp ON emp.id = ep.employee_id
    LEFT JOIN hr_persons per ON per.id = emp.person_id
    WHERE p.active = true
    ORDER BY lower(p.title) ASC
  `);
  return { departments, positions };
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Vacancy Requests
// ---------------------------------------------------------------------

const VACANCY_REQUEST_FIELDS = [
  'position_title', 'department_id', 'hiring_manager_employee_id', 'request_reason', 'quantity', 'priority',
  'desired_start_date', 'ideal_candidate_portrait', 'responsibilities', 'skills_professional', 'skills_technical',
  'skills_additional', 'product_knowledge', 'personal_qualities_required', 'personal_qualities_desired',
  'compensation_trial', 'compensation_probation', 'compensation_after_probation', 'compensation_bonus_formula',
  'probation_goals', 'career_growth', 'notes'
];

async function listVacancyRequests({ status = '' } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`vr.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT vr.*, d.name AS department_name, per.full_name AS hiring_manager_name
    FROM hr_vacancy_requests vr
    JOIN hr_departments d ON d.id = vr.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = vr.hiring_manager_employee_id
    LEFT JOIN hr_persons per ON per.id = mgr.person_id
    ${where}
    ORDER BY vr.created_at DESC
  `, params);
  return rows;
}

async function getVacancyRequest(id) {
  const { rows } = await pool.query(`
    SELECT vr.*, d.name AS department_name, per.full_name AS hiring_manager_name
    FROM hr_vacancy_requests vr
    JOIN hr_departments d ON d.id = vr.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = vr.hiring_manager_employee_id
    LEFT JOIN hr_persons per ON per.id = mgr.person_id
    WHERE vr.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: vacancies } = await pool.query(`SELECT * FROM hr_vacancies WHERE vacancy_request_id = $1`, [id]);
  return { ...rows[0], vacancy: vacancies[0] || null };
}

const VACANCY_REQUEST_NULLABLE_FIELDS = new Set(['hiring_manager_employee_id', 'desired_start_date']);

async function createVacancyRequest(fields, created_by) {
  const cols = VACANCY_REQUEST_FIELDS;
  const values = cols.map((c) => {
    if (c === 'quantity') return fields.quantity || 1;
    if (VACANCY_REQUEST_NULLABLE_FIELDS.has(c)) return fields[c] || null;
    return fields[c] ?? '';
  });
  const { rows } = await pool.query(
    `INSERT INTO hr_vacancy_requests (${cols.join(', ')}, created_by)
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}, $${cols.length + 1}) RETURNING *`,
    [...values, created_by || '']
  );
  await writeAudit({ actor: created_by, action: 'create', entity_type: 'vacancy_request', entity_id: rows[0].id, new_value: { position_title: rows[0].position_title } });
  return rows[0];
}

async function updateVacancyRequest(id, fields) {
  const cols = VACANCY_REQUEST_FIELDS.filter((c) => fields[c] !== undefined);
  if (!cols.length) return getVacancyRequest(id);
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE hr_vacancy_requests SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => fields[c])]
  );
  return rows[0] || null;
}

async function updateVacancyRequestStatus(id, status, status_note, actor) {
  if (!VACANCY_REQUEST_STATUSES.includes(status)) {
    throw new Error(`Unknown vacancy request status: ${status}`);
  }
  const { rows: before } = await pool.query('SELECT status FROM hr_vacancy_requests WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_vacancy_requests SET status = $2, status_note = COALESCE($3, status_note), updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status, status_note ?? null]
  );
  await writeAudit({ actor, action: 'status_change', entity_type: 'vacancy_request', entity_id: id, old_value: { status: before[0].status }, new_value: { status } });
  return rows[0];
}

// Convert to Vacancy — окрема свідома дія (ТЗ 9.2), не автоматично на
// Approved; idempotent — повторний виклик повертає вже створену вакансію.
async function convertVacancyRequestToVacancy(requestId, { position_id, recruiter_username, target_date, priority }, actor) {
  const { rows: existing } = await pool.query(`SELECT * FROM hr_vacancies WHERE vacancy_request_id = $1`, [requestId]);
  if (existing[0]) return existing[0];

  const request = await getVacancyRequest(requestId);
  if (!request) throw new Error('Заявку на вакансію не знайдено');
  if (request.status !== 'Approved') {
    throw new Error('Конвертувати у вакансію можна лише погоджену заявку (Approved)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO hr_vacancies (vacancy_request_id, position_id, department_id, hiring_manager_employee_id, recruiter_username, title, priority, target_date, profile_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [requestId, position_id || null, request.department_id, request.hiring_manager_employee_id, recruiter_username || '',
        request.position_title, priority || request.priority || '', target_date || null, request.ideal_candidate_portrait || '']
    );
    await client.query(`UPDATE hr_vacancy_requests SET status = 'Converted to Vacancy', updated_at = now() WHERE id = $1`, [requestId]);
    if (position_id) {
      await client.query(`UPDATE hr_positions SET status = 'Recruitment Active', updated_at = now() WHERE id = $1`, [position_id]);
    }
    await client.query('COMMIT');
    await writeAudit({ actor, action: 'convert_to_vacancy', entity_type: 'vacancy_request', entity_id: requestId, new_value: { vacancy_id: rows[0].id } });
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Vacancies
// ---------------------------------------------------------------------

async function listVacancies({ status = '' } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`v.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT v.*, d.name AS department_name, per.full_name AS hiring_manager_name,
      (SELECT COUNT(*)::int FROM hr_applications a WHERE a.vacancy_id = v.id AND a.status = 'Active') AS active_applications_count
    FROM hr_vacancies v
    JOIN hr_departments d ON d.id = v.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = v.hiring_manager_employee_id
    LEFT JOIN hr_persons per ON per.id = mgr.person_id
    ${where}
    ORDER BY v.created_at DESC
  `, params);
  return rows;
}

async function getVacancy(id) {
  const { rows } = await pool.query(`
    SELECT v.*, d.name AS department_name, per.full_name AS hiring_manager_name
    FROM hr_vacancies v
    JOIN hr_departments d ON d.id = v.department_id
    LEFT JOIN hr_employees mgr ON mgr.id = v.hiring_manager_employee_id
    LEFT JOIN hr_persons per ON per.id = mgr.person_id
    WHERE v.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const applications = await listApplicationsForVacancy(id);
  return { ...rows[0], applications };
}

async function createVacancy({ position_id, department_id, hiring_manager_employee_id, recruiter_username, title, priority, target_date, profile_snapshot, override_reason }, created_by) {
  const { rows } = await pool.query(
    `INSERT INTO hr_vacancies (position_id, department_id, hiring_manager_employee_id, recruiter_username, title, priority, target_date, profile_snapshot, override_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [position_id || null, department_id, hiring_manager_employee_id || null, recruiter_username || '', title, priority || '', target_date || null, profile_snapshot || '', override_reason || '']
  );
  await writeAudit({ actor: created_by, action: 'create', entity_type: 'vacancy', entity_id: rows[0].id, new_value: { title } });
  return rows[0];
}

async function updateVacancy(id, { recruiter_username, priority, target_date, profile_snapshot }) {
  const { rows } = await pool.query(
    `UPDATE hr_vacancies SET
       recruiter_username = COALESCE($2, recruiter_username),
       priority = COALESCE($3, priority),
       target_date = $4,
       profile_snapshot = COALESCE($5, profile_snapshot),
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, recruiter_username ?? null, priority ?? null, target_date ?? null, profile_snapshot ?? null]
  );
  return rows[0] || null;
}

async function updateVacancyStatus(id, status, actor) {
  if (!VACANCY_STATUSES.includes(status)) {
    throw new Error(`Unknown vacancy status: ${status}`);
  }
  const { rows: before } = await pool.query('SELECT status, position_id FROM hr_vacancies WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_vacancies SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  if (before[0].position_id && (status === 'Cancelled' || status === 'Closed') && before[0].status !== 'Filled') {
    await pool.query(`UPDATE hr_positions SET status = 'Vacant', updated_at = now() WHERE id = $1 AND status = 'Recruitment Active'`, [before[0].position_id]);
  }
  await writeAudit({ actor, action: 'status_change', entity_type: 'vacancy', entity_id: id, old_value: { status: before[0].status }, new_value: { status } });
  return rows[0];
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Candidates
// ---------------------------------------------------------------------

async function findDuplicateCandidate({ phone, personal_email }) {
  const conditions = [];
  const params = [];
  if (phone) {
    params.push(phone);
    conditions.push(`per.phone = $${params.length}`);
  }
  if (personal_email) {
    params.push(personal_email.toLowerCase());
    conditions.push(`lower(per.personal_email) = $${params.length}`);
  }
  if (!conditions.length) return null;
  const { rows } = await pool.query(`
    SELECT c.*, per.full_name, per.phone, per.personal_email
    FROM hr_candidates c JOIN hr_persons per ON per.id = c.person_id
    WHERE ${conditions.join(' OR ')}
    LIMIT 1
  `, params);
  return rows[0] || null;
}

// Дублікати за телефоном/email не створюються повторно — та сама Person
// (ТЗ п.3 "one person — one master record"); повертаємо існуючого
// кандидата з прапорцем duplicate: true, щоб UI попередив користувача.
async function createCandidate({ full_name, phone, personal_email, telegram, city, current_job_title, desired_role,
  desired_salary, source, owner_recruiter, resume_url, notes }, created_by) {
  const duplicate = await findDuplicateCandidate({ phone, personal_email });
  if (duplicate) {
    return { candidate: duplicate, duplicate: true };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: personRows } = await client.query(
      `INSERT INTO hr_persons (full_name, phone, personal_email, telegram, city) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [full_name, phone || '', personal_email || '', telegram || '', city || '']
    );
    const person = personRows[0];
    const { rows: candRows } = await client.query(
      `INSERT INTO hr_candidates (person_id, current_job_title, desired_role, desired_salary, source, owner_recruiter, resume_url, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [person.id, current_job_title || '', desired_role || '', desired_salary || '', source || '', owner_recruiter || '', resume_url || '', notes || '']
    );
    await client.query('COMMIT');
    await writeAudit({ actor: created_by, action: 'create', entity_type: 'candidate', entity_id: candRows[0].id, new_value: { full_name } });
    return { candidate: { ...candRows[0], full_name, phone: phone || '', personal_email: personal_email || '' }, duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function listCandidates({ search = '' } = {}) {
  const conditions = [];
  const params = [];
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(lower(per.full_name) LIKE $${params.length} OR lower(per.phone) LIKE $${params.length} OR lower(per.personal_email) LIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT c.*, per.full_name, per.phone, per.personal_email, per.telegram, per.city,
      (SELECT COUNT(*)::int FROM hr_applications a WHERE a.candidate_id = c.id AND a.status = 'Active') AS active_applications_count
    FROM hr_candidates c
    JOIN hr_persons per ON per.id = c.person_id
    ${where}
    ORDER BY c.created_at DESC
  `, params);
  return rows;
}

async function getCandidate(id) {
  const { rows } = await pool.query(`
    SELECT c.*, per.*, c.id AS id, c.created_at AS created_at
    FROM hr_candidates c JOIN hr_persons per ON per.id = c.person_id
    WHERE c.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: applications } = await pool.query(`
    SELECT a.*, v.title AS vacancy_title, v.status AS vacancy_status
    FROM hr_applications a JOIN hr_vacancies v ON v.id = a.vacancy_id
    WHERE a.candidate_id = $1
    ORDER BY a.created_at DESC
  `, [id]);
  return { ...rows[0], applications };
}

async function updateCandidateFields(id, { current_job_title, desired_role, desired_salary, source, owner_recruiter,
  resume_url, notes, talent_pool_segment, talent_pool_category, talent_pool_next_contact }) {
  const { rows } = await pool.query(
    `UPDATE hr_candidates SET
       current_job_title = COALESCE($2, current_job_title),
       desired_role = COALESCE($3, desired_role),
       desired_salary = COALESCE($4, desired_salary),
       source = COALESCE($5, source),
       owner_recruiter = COALESCE($6, owner_recruiter),
       resume_url = COALESCE($7, resume_url),
       notes = COALESCE($8, notes),
       talent_pool_segment = COALESCE($9, talent_pool_segment),
       talent_pool_category = COALESCE($10, talent_pool_category),
       talent_pool_next_contact = $11,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, current_job_title ?? null, desired_role ?? null, desired_salary ?? null, source ?? null, owner_recruiter ?? null,
      resume_url ?? null, notes ?? null, talent_pool_segment ?? null, talent_pool_category ?? null, talent_pool_next_contact ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Applications
// ---------------------------------------------------------------------

async function listApplicationsForVacancy(vacancyId) {
  const { rows } = await pool.query(`
    SELECT a.*, per.full_name AS candidate_name, per.phone AS candidate_phone, per.personal_email AS candidate_email
    FROM hr_applications a
    JOIN hr_candidates c ON c.id = a.candidate_id
    JOIN hr_persons per ON per.id = c.person_id
    WHERE a.vacancy_id = $1
    ORDER BY a.created_at DESC
  `, [vacancyId]);
  return rows;
}

async function getApplication(id) {
  const { rows } = await pool.query(`
    SELECT a.*, per.full_name AS candidate_name, per.phone AS candidate_phone, per.personal_email AS candidate_email,
      v.title AS vacancy_title, v.status AS vacancy_status, v.department_id
    FROM hr_applications a
    JOIN hr_candidates c ON c.id = a.candidate_id
    JOIN hr_persons per ON per.id = c.person_id
    JOIN hr_vacancies v ON v.id = a.vacancy_id
    WHERE a.id = $1
  `, [id]);
  if (!rows[0]) return null;
  const { rows: interviews } = await pool.query(`SELECT * FROM hr_interviews WHERE application_id = $1 ORDER BY scheduled_at DESC NULLS LAST, id DESC`, [id]);
  const { rows: offers } = await pool.query(`SELECT * FROM hr_offers WHERE application_id = $1 ORDER BY created_at DESC`, [id]);
  return { ...rows[0], interviews, offers };
}

// Заявка кандидата на вакансію — унікальна пара (candidate_id, vacancy_id);
// повторний виклик повертає вже існуючу заявку (idempotent).
async function createApplication({ candidate_id, vacancy_id, applied_date }, created_by) {
  const { rows: existing } = await pool.query(
    `SELECT * FROM hr_applications WHERE candidate_id = $1 AND vacancy_id = $2`,
    [candidate_id, vacancy_id]
  );
  if (existing[0]) return existing[0];
  const { rows } = await pool.query(
    `INSERT INTO hr_applications (candidate_id, vacancy_id, applied_date, created_by)
     VALUES ($1,$2,COALESCE($3, CURRENT_DATE),$4) RETURNING *`,
    [candidate_id, vacancy_id, applied_date || null, created_by || '']
  );
  await writeAudit({ actor: created_by, action: 'create', entity_type: 'application', entity_id: rows[0].id, new_value: { candidate_id, vacancy_id } });
  return rows[0];
}

async function updateApplicationStage(id, stage, actor) {
  if (!APPLICATION_STAGES.includes(stage)) {
    throw new Error(`Unknown application stage: ${stage}`);
  }
  const { rows: before } = await pool.query('SELECT stage FROM hr_applications WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_applications SET stage = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, stage]
  );
  await writeAudit({ actor, action: 'stage_change', entity_type: 'application', entity_id: id, old_value: { stage: before[0].stage }, new_value: { stage } });
  return rows[0];
}

async function updateApplicationStatus(id, { status, rejection_reason, rejection_comment, next_action, next_action_date }, actor) {
  if (!APPLICATION_STATUSES.includes(status)) {
    throw new Error(`Unknown application status: ${status}`);
  }
  if (status === 'Rejected' && !rejection_reason) {
    throw new Error('Для відмови потрібно вказати причину');
  }
  const { rows: before } = await pool.query('SELECT status FROM hr_applications WHERE id = $1', [id]);
  if (!before[0]) return null;
  const { rows } = await pool.query(
    `UPDATE hr_applications SET
       status = $2,
       rejection_reason = COALESCE($3, rejection_reason),
       rejection_comment = COALESCE($4, rejection_comment),
       next_action = COALESCE($5, next_action),
       next_action_date = $6,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, status, rejection_reason ?? null, rejection_comment ?? null, next_action ?? null, next_action_date ?? null]
  );
  await writeAudit({ actor, action: 'status_change', entity_type: 'application', entity_id: id, old_value: { status: before[0].status }, new_value: { status, rejection_reason } });
  return rows[0];
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Interviews
// ---------------------------------------------------------------------

async function createInterview({ application_id, interview_type, scheduled_at, participants, notes }, created_by) {
  if (interview_type && !INTERVIEW_TYPES.includes(interview_type)) {
    throw new Error(`Unknown interview type: ${interview_type}`);
  }
  const { rows } = await pool.query(
    `INSERT INTO hr_interviews (application_id, interview_type, scheduled_at, participants, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [application_id, interview_type || '', scheduled_at || null, participants || '', notes || '', created_by || '']
  );
  return rows[0];
}

async function listInterviewsForApplication(applicationId) {
  const { rows } = await pool.query(
    `SELECT * FROM hr_interviews WHERE application_id = $1 ORDER BY scheduled_at DESC NULLS LAST, id DESC`,
    [applicationId]
  );
  return rows;
}

async function updateInterview(id, { status, notes, decision, scheduled_at, participants }) {
  if (status && !INTERVIEW_STATUSES.includes(status)) {
    throw new Error(`Unknown interview status: ${status}`);
  }
  const { rows } = await pool.query(
    `UPDATE hr_interviews SET
       status = COALESCE($2, status),
       notes = COALESCE($3, notes),
       decision = COALESCE($4, decision),
       scheduled_at = COALESCE($5, scheduled_at),
       participants = COALESCE($6, participants)
     WHERE id = $1 RETURNING *`,
    [id, status ?? null, notes ?? null, decision ?? null, scheduled_at ?? null, participants ?? null]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Recruitment / ATS — Offers (Accepted → Future Employee, рівно один раз)
// ---------------------------------------------------------------------

async function createOffer({ application_id, fixed_salary, currency, bonus_formula, kpi_bonus, start_date,
  probation_goals, acceptance_deadline }, created_by) {
  const { rows } = await pool.query(
    `INSERT INTO hr_offers (application_id, fixed_salary, currency, bonus_formula, kpi_bonus, start_date, probation_goals, acceptance_deadline, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [application_id, fixed_salary || null, currency || 'UAH', bonus_formula || '', kpi_bonus || '', start_date || null,
      probation_goals || '', acceptance_deadline || null, created_by || '']
  );
  await writeAudit({ actor: created_by, action: 'create', entity_type: 'offer', entity_id: rows[0].id, new_value: { application_id } });
  return rows[0];
}

async function getOffer(id) {
  const { rows } = await pool.query(`SELECT * FROM hr_offers WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function updateOffer(id, { fixed_salary, currency, bonus_formula, kpi_bonus, start_date, probation_goals, acceptance_deadline }) {
  const { rows } = await pool.query(
    `UPDATE hr_offers SET
       fixed_salary = COALESCE($2, fixed_salary),
       currency = COALESCE($3, currency),
       bonus_formula = COALESCE($4, bonus_formula),
       kpi_bonus = COALESCE($5, kpi_bonus),
       start_date = COALESCE($6, start_date),
       probation_goals = COALESCE($7, probation_goals),
       acceptance_deadline = $8,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, fixed_salary ?? null, currency ?? null, bonus_formula ?? null, kpi_bonus ?? null, start_date ?? null, probation_goals ?? null, acceptance_deadline ?? null]
  );
  return rows[0] || null;
}

async function updateOfferStatus(id, status, actor, approved_by) {
  if (!OFFER_STATUSES.includes(status)) {
    throw new Error(`Unknown offer status: ${status}`);
  }
  const offer = await getOffer(id);
  if (!offer) return null;

  if (status === 'Sent' && (!offer.fixed_salary || !offer.start_date)) {
    throw new Error('Перед відправкою офера потрібно вказати оклад і дату старту');
  }

  // Idempotent: якщо співробітника вже створено з цього офера — повторний
  // Accepted нічого не дублює (ТЗ п.37).
  if (status === 'Accepted' && offer.employee_id) {
    return offer;
  }

  if (status !== 'Accepted') {
    const { rows } = await pool.query(
      `UPDATE hr_offers SET status = $2, approved_by = COALESCE($3, approved_by), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, status, approved_by ?? null]
    );
    await writeAudit({ actor, action: 'status_change', entity_type: 'offer', entity_id: id, old_value: { status: offer.status }, new_value: { status } });
    return rows[0];
  }

  const application = await getApplication(offer.application_id);
  if (!application) throw new Error('Заявку кандидата не знайдено');

  const { rows: candRows } = await pool.query(`SELECT person_id FROM hr_candidates WHERE id = $1`, [application.candidate_id]);
  const personId = candRows[0]?.person_id;
  if (!personId) throw new Error('Не знайдено персональний профіль кандидата');

  const { rows: vacRows } = await pool.query(`SELECT position_id, department_id, hiring_manager_employee_id FROM hr_vacancies WHERE id = $1`, [application.vacancy_id]);
  const vacancy = vacRows[0];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: empRows } = await client.query(
      `INSERT INTO hr_employees (person_id, status, first_hire_date)
       VALUES ($1,'Future Employee',$2) RETURNING *`,
      [personId, offer.start_date || null]
    );
    const employee = empRows[0];

    if (vacancy?.position_id && vacancy?.department_id && offer.start_date) {
      await client.query(
        `INSERT INTO hr_employment_periods (employee_id, position_id, department_id, manager_employee_id, start_date, change_reason)
         VALUES ($1,$2,$3,$4,$5,'Прийняття офера')`,
        [employee.id, vacancy.position_id, vacancy.department_id, vacancy.hiring_manager_employee_id || null, offer.start_date]
      );
      await client.query(`UPDATE hr_positions SET status = 'Filled', updated_at = now() WHERE id = $1`, [vacancy.position_id]);
    }

    const { rows: offerRows } = await client.query(
      `UPDATE hr_offers SET status = 'Accepted', employee_id = $2, approved_by = COALESCE($3, approved_by), updated_at = now() WHERE id = $1 RETURNING *`,
      [id, employee.id, approved_by ?? null]
    );
    await client.query(`UPDATE hr_applications SET status = 'Hired', stage = 'Hired', updated_at = now() WHERE id = $1`, [offer.application_id]);
    await client.query(`UPDATE hr_vacancies SET status = 'Filled', updated_at = now() WHERE id = $1`, [application.vacancy_id]);

    await client.query('COMMIT');
    await writeAudit({ actor, action: 'offer_accepted', entity_type: 'offer', entity_id: id, new_value: { employee_id: employee.id } });
    return offerRows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export default {
  initSchema,
  EMPLOYEE_STATUSES,
  POSITION_STATUSES,
  RESERVATION_STATUSES,
  VACANCY_REQUEST_STATUSES,
  VACANCY_STATUSES,
  APPLICATION_STAGES,
  APPLICATION_STATUSES,
  REJECTION_REASONS_COMPANY,
  REJECTION_REASONS_CANDIDATE,
  OFFER_STATUSES,
  INTERVIEW_TYPES,
  INTERVIEW_STATUSES,
  createAccountIfMissingWithHash,
  findAccountByUsername,
  verifyAccountPassword,
  createSession,
  touchSession,
  deleteSession,
  cleanupExpiredSessions,
  writeAudit,
  listAuditLog,
  listDepartments,
  createDepartment,
  updateDepartment,
  listPositions,
  createPosition,
  updatePosition,
  listEmployees,
  getEmployee,
  createEmployee,
  updatePersonFields,
  updateEmployeeStatus,
  updateEmployeeFields,
  changeEmployment,
  addCompensationRecord,
  getOrgTree,
  listVacancyRequests,
  getVacancyRequest,
  createVacancyRequest,
  updateVacancyRequest,
  updateVacancyRequestStatus,
  convertVacancyRequestToVacancy,
  listVacancies,
  getVacancy,
  createVacancy,
  updateVacancy,
  updateVacancyStatus,
  findDuplicateCandidate,
  createCandidate,
  listCandidates,
  getCandidate,
  updateCandidateFields,
  listApplicationsForVacancy,
  getApplication,
  createApplication,
  updateApplicationStage,
  updateApplicationStatus,
  createInterview,
  listInterviewsForApplication,
  updateInterview,
  createOffer,
  getOffer,
  updateOffer,
  updateOfferStatus
};
