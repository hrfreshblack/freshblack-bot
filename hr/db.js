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

export default {
  initSchema,
  EMPLOYEE_STATUSES,
  POSITION_STATUSES,
  RESERVATION_STATUSES,
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
  getOrgTree
};
