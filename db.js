import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      employee_id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL DEFAULT '',
      telegram_chat_id TEXT NOT NULL DEFAULT '',
      telegram_user_id TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS checkins (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL DEFAULT '',
      telegram_chat_id TEXT NOT NULL DEFAULT '',
      telegram_user_id TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT '',
      entry_type TEXT NOT NULL DEFAULT '',
      work_format TEXT NOT NULL DEFAULT '',
      remote_reason TEXT NOT NULL DEFAULT '',
      kyiv_date TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_checkins_kyiv_date ON checkins(kyiv_date);

    CREATE TABLE IF NOT EXISTS production_shift_log (
      id SERIAL PRIMARY KEY,
      shift_id TEXT NOT NULL DEFAULT '',
      opened_at TEXT NOT NULL DEFAULT '',
      closed_at TEXT NOT NULL DEFAULT '',
      employee_id TEXT NOT NULL DEFAULT '',
      telegram_chat_id TEXT NOT NULL DEFAULT '',
      telegram_user_id TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '',
      station_name TEXT NOT NULL DEFAULT '',
      result_text TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS timeoff_requests (
      request_id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL DEFAULT '',
      telegram_chat_id TEXT NOT NULL DEFAULT '',
      telegram_user_id TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '',
      request_type TEXT NOT NULL DEFAULT '',
      request_subtype TEXT NOT NULL DEFAULT '',
      date_from TEXT NOT NULL DEFAULT '',
      date_to TEXT NOT NULL DEFAULT '',
      date_from_iso TEXT NOT NULL DEFAULT '',
      date_to_iso TEXT NOT NULL DEFAULT '',
      replacement_person TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending_hrd',
      status_hr TEXT NOT NULL DEFAULT 'pending_hrd',
      status_chief_acc TEXT NOT NULL DEFAULT '',
      final_status TEXT NOT NULL DEFAULT 'pending_hrd',
      approved_by_hrd TEXT NOT NULL DEFAULT '',
      approved_at_hrd TEXT NOT NULL DEFAULT '',
      approved_by_accountant TEXT NOT NULL DEFAULT '',
      approved_at_accountant TEXT NOT NULL DEFAULT '',
      hr_message_id TEXT NOT NULL DEFAULT '',
      accountant_message_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_timeoff_employee ON timeoff_requests(employee_id);

    -- Патч для баз, де таблицю timeoff_requests вже створено без цих колонок
    -- (CREATE TABLE IF NOT EXISTS вище не додає колонки в уже існуючу таблицю).
    ALTER TABLE timeoff_requests ADD COLUMN IF NOT EXISTS approved_by_hrd TEXT NOT NULL DEFAULT '';
    ALTER TABLE timeoff_requests ADD COLUMN IF NOT EXISTS approved_at_hrd TEXT NOT NULL DEFAULT '';
    ALTER TABLE timeoff_requests ADD COLUMN IF NOT EXISTS approved_by_accountant TEXT NOT NULL DEFAULT '';
    ALTER TABLE timeoff_requests ADD COLUMN IF NOT EXISTS approved_at_accountant TEXT NOT NULL DEFAULT '';

    -- Розмовний стан бота (на якому кроці людина, що вже обрано) — раніше
    -- жив у файлі на диску Railway, який стирається при кожному деплої.
    -- Тепер тут, разом з усім іншим, переживає будь-який деплой/рестарт.
    CREATE TABLE IF NOT EXISTS bot_sessions (
      chat_id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Який слот нагадувань уже спрацював сьогодні — той самий case: раніше
    -- файл на диску, тепер один рядок тут.
    CREATE TABLE IF NOT EXISTS scheduler_state (
      id INT PRIMARY KEY DEFAULT 1,
      date_key TEXT NOT NULL DEFAULT '',
      fired JSONB NOT NULL DEFAULT '[]',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS outbox (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      payload JSONB NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      synced_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(id) WHERE synced_at IS NULL;
  `);
}

// ---- employees ----

async function getEmployeeById(employeeId) {
  const { rows } = await pool.query('SELECT * FROM employees WHERE employee_id = $1', [employeeId]);
  return rows[0] || null;
}

async function countEmployees() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM employees');
  return rows[0].n;
}

// Called from the bot itself when it learns an employee's Telegram identity
// (e.g. /start). telegram_chat_id/telegram_user_id are local-authoritative
// from here on — the periodic pull from Sheets (below) never overwrites them.
async function upsertEmployeeChat(employeeId, fullName, chatId, userId) {
  await pool.query(
    `INSERT INTO employees (employee_id, full_name, telegram_chat_id, telegram_user_id, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (employee_id) DO UPDATE SET
       full_name = CASE WHEN excluded.full_name <> '' THEN excluded.full_name ELSE employees.full_name END,
       telegram_chat_id = CASE WHEN excluded.telegram_chat_id <> '' THEN excluded.telegram_chat_id ELSE employees.telegram_chat_id END,
       telegram_user_id = CASE WHEN excluded.telegram_user_id <> '' THEN excluded.telegram_user_id ELSE employees.telegram_user_id END,
       updated_at = now()`,
    [employeeId, fullName || '', chatId || '', userId || '']
  );
}

// Called from the periodic full pull of the `employees` sheet. Only touches
// full_name/active — telegram_chat_id/telegram_user_id are owned locally by
// the bot (see upsertEmployeeChat above) and never pulled back from Sheets.
async function upsertEmployeeFromSheet(employeeId, fullName, active) {
  await pool.query(
    `INSERT INTO employees (employee_id, full_name, active, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (employee_id) DO UPDATE SET
       full_name = excluded.full_name,
       active = excluded.active,
       updated_at = now()`,
    [employeeId, fullName || '', active]
  );
}

// ---- checkins ----

async function insertCheckin(row) {
  await pool.query(
    `INSERT INTO checkins
       (employee_id, telegram_chat_id, telegram_user_id, full_name, type, mode, entry_type, work_format, remote_reason, kyiv_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      row.employee_id || '',
      row.telegram_chat_id || '',
      row.telegram_user_id || '',
      row.full_name || '',
      row.type,
      row.mode || '',
      row.entry_type || '',
      row.work_format || '',
      row.remote_reason || '',
      row.kyiv_date
    ]
  );
}

// Mirrors Apps Script's getDailyCheckinStatus_/hasTodayType_: matches by
// whichever identifier is available (employee_id, chat_id, user_id, or
// lowercased full_name), restricted to today's rows.
async function getTodayCheckinStatus(identity, kyivDate) {
  const { rows } = await pool.query(
    `SELECT type, entry_type, work_format FROM checkins
     WHERE kyiv_date = $1
       AND (
         ($2 <> '' AND employee_id = $2) OR
         ($3 <> '' AND telegram_chat_id = $3) OR
         ($4 <> '' AND telegram_user_id = $4) OR
         ($5 <> '' AND lower(full_name) = $5)
       )
     ORDER BY id ASC`,
    [kyivDate, identity.employee_id || '', identity.telegram_chat_id || '', identity.telegram_user_id || '', identity.full_name || '']
  );

  let hasAny = false;
  let hasIn = false;
  let hasOut = false;
  let lastEntryType = '';
  let lastWorkFormat = '';

  rows.forEach((row) => {
    hasAny = true;
    if (row.type === 'in') hasIn = true;
    if (row.type === 'out') hasOut = true;
    lastEntryType = row.entry_type || lastEntryType;
    lastWorkFormat = row.work_format || lastWorkFormat;
  });

  return { has_any: hasAny, has_in: hasIn, has_out: hasOut, last_entry_type: lastEntryType, last_work_format: lastWorkFormat };
}

async function listOpeningReminderTargets(kyivDate) {
  const { rows } = await pool.query(
    `SELECT e.employee_id, e.full_name, e.telegram_chat_id, e.telegram_user_id
     FROM employees e
     WHERE e.active = true AND e.telegram_chat_id <> ''
       AND NOT EXISTS (
         SELECT 1 FROM timeoff_requests t
         WHERE t.employee_id = e.employee_id
           AND t.date_from_iso <> '' AND t.date_to_iso <> ''
           AND lower(t.status) <> 'rejected' AND lower(t.final_status) <> 'rejected'
           AND $1 BETWEEN t.date_from_iso AND t.date_to_iso
       )
       AND NOT EXISTS (
         SELECT 1 FROM checkins c
         WHERE c.employee_id = e.employee_id AND c.kyiv_date = $1 AND c.type = 'in'
       )`,
    [kyivDate]
  );
  return rows;
}

async function listClosingReminderTargets(entryType, kyivDate) {
  const { rows } = await pool.query(
    `WITH todays AS (
       SELECT employee_id, telegram_chat_id, telegram_user_id, full_name, entry_type,
              bool_or(type = 'in') AS has_in,
              bool_or(type = 'out') AS has_out
       FROM checkins
       WHERE kyiv_date = $2
         AND ($1 = '' OR entry_type = $1)
         AND employee_id <> '' AND telegram_chat_id <> ''
       GROUP BY employee_id, telegram_chat_id, telegram_user_id, full_name, entry_type
     )
     SELECT employee_id, telegram_chat_id, telegram_user_id, full_name, entry_type
     FROM todays t
     WHERE has_in AND NOT has_out
       AND NOT EXISTS (
         SELECT 1 FROM timeoff_requests tr
         WHERE tr.employee_id = t.employee_id
           AND tr.date_from_iso <> '' AND tr.date_to_iso <> ''
           AND lower(tr.status) <> 'rejected' AND lower(tr.final_status) <> 'rejected'
           AND $2 BETWEEN tr.date_from_iso AND tr.date_to_iso
       )`,
    [entryType || '', kyivDate]
  );
  return rows;
}

// ---- production shifts ----

async function insertProductionShiftEntries(rows) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      await client.query(
        `INSERT INTO production_shift_log
           (shift_id, opened_at, closed_at, employee_id, telegram_chat_id, telegram_user_id, full_name, station_name, result_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          row.shift_id || '',
          row.opened_at || '',
          row.closed_at || '',
          row.employee_id || '',
          row.telegram_chat_id || '',
          row.telegram_user_id || '',
          row.full_name || '',
          row.station_name || '',
          row.result_text || ''
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---- timeoff requests ----

async function insertTimeoffRequest(row) {
  await pool.query(
    `INSERT INTO timeoff_requests
       (request_id, employee_id, telegram_chat_id, telegram_user_id, full_name, request_type, request_subtype,
        date_from, date_to, date_from_iso, date_to_iso, replacement_person, comment,
        status, status_hr, status_chief_acc, final_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      row.request_id,
      row.employee_id || '',
      row.telegram_chat_id || '',
      row.telegram_user_id || '',
      row.full_name || '',
      row.request_type || '',
      row.request_subtype || '',
      row.date_from || '',
      row.date_to || '',
      row.date_from_iso || '',
      row.date_to_iso || '',
      row.replacement_person || '',
      row.comment || '',
      'pending_hrd',
      'pending_hrd',
      '',
      'pending_hrd'
    ]
  );
}

async function getTimeoffRequestById(requestId) {
  const { rows } = await pool.query('SELECT * FROM timeoff_requests WHERE request_id = $1', [requestId]);
  return rows[0] || null;
}

async function updateTimeoffStatus(requestId, fields) {
  const editableKeys = [
    'status',
    'approved_by_hrd',
    'approved_at_hrd',
    'approved_by_accountant',
    'approved_at_accountant',
    'status_hr',
    'status_chief_acc',
    'final_status',
    'hr_message_id',
    'accountant_message_id'
  ];

  const sets = [];
  const values = [];
  editableKeys.forEach((key) => {
    if (typeof fields[key] === 'undefined') return;
    values.push(fields[key]);
    sets.push(`${key} = $${values.length}`);
  });
  if (!sets.length) return;

  values.push(requestId);
  await pool.query(`UPDATE timeoff_requests SET ${sets.join(', ')} WHERE request_id = $${values.length}`, values);
}

async function isAbsentOnDate(identity, dateIso) {
  const { rows } = await pool.query(
    `SELECT request_type FROM timeoff_requests
     WHERE (
         ($1 <> '' AND employee_id = $1) OR
         ($2 <> '' AND telegram_chat_id = $2) OR
         ($3 <> '' AND telegram_user_id = $3) OR
         ($4 <> '' AND lower(full_name) = $4)
       )
       AND date_from_iso <> '' AND date_to_iso <> ''
       AND lower(status) <> 'rejected' AND lower(final_status) <> 'rejected'
       AND $5 BETWEEN date_from_iso AND date_to_iso
     LIMIT 1`,
    [identity.employee_id || '', identity.telegram_chat_id || '', identity.telegram_user_id || '', identity.full_name || '', dateIso]
  );
  if (!rows.length) return { absent: false, reason: '' };
  return { absent: true, reason: rows[0].request_type || '' };
}

async function countTimeoffRequests() {
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM timeoff_requests');
  return rows[0].n;
}

async function backfillTimeoffRequests(rows) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      if (!row.request_id) continue;
      await client.query(
        `INSERT INTO timeoff_requests
           (request_id, employee_id, telegram_chat_id, telegram_user_id, full_name, request_type, request_subtype,
            date_from, date_to, date_from_iso, date_to_iso, replacement_person, comment,
            status, status_hr, status_chief_acc, final_status, hr_message_id, accountant_message_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (request_id) DO NOTHING`,
        [
          row.request_id,
          row.employee_id || '',
          row.telegram_chat_id || '',
          row.telegram_user_id || '',
          row.full_name || '',
          row.request_type || '',
          row.request_subtype || '',
          row.date_from || '',
          row.date_to || '',
          row.date_from_iso || '',
          row.date_to_iso || '',
          row.replacement_person || '',
          row.comment || '',
          row.status || 'pending_hrd',
          row.status_hr || 'pending_hrd',
          row.status_chief_acc || '',
          row.final_status || 'pending_hrd',
          row.hr_message_id || '',
          row.accountant_message_id || ''
        ]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ---- outbox: queued writes that still need to reach the Google Sheets bridge ----

async function enqueueOutbox(action, payload) {
  await pool.query('INSERT INTO outbox (action, payload) VALUES ($1, $2)', [action, JSON.stringify(payload)]);
}

async function getPendingOutbox(limit = 20) {
  const { rows } = await pool.query(
    'SELECT id, action, payload, attempts FROM outbox WHERE synced_at IS NULL ORDER BY id ASC LIMIT $1',
    [limit]
  );
  return rows;
}

async function markOutboxSynced(id) {
  await pool.query('UPDATE outbox SET synced_at = now() WHERE id = $1', [id]);
}

async function markOutboxFailed(id, errorMessage) {
  await pool.query('UPDATE outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1', [id, String(errorMessage || '').slice(0, 500)]);
}

// ---- bot sessions ----

async function loadAllSessions() {
  const { rows } = await pool.query('SELECT chat_id, data FROM bot_sessions');
  return rows;
}

async function saveSession(chatId, data) {
  await pool.query(
    `INSERT INTO bot_sessions (chat_id, data, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (chat_id) DO UPDATE SET data = excluded.data, updated_at = now()`,
    [chatId, JSON.stringify(data)]
  );
}

// ---- scheduler state (which reminder slots already fired today) ----

async function loadSchedulerState() {
  const { rows } = await pool.query('SELECT date_key, fired FROM scheduler_state WHERE id = 1');
  return rows[0] || null;
}

async function saveSchedulerState(dateKey, fired) {
  await pool.query(
    `INSERT INTO scheduler_state (id, date_key, fired, updated_at)
     VALUES (1, $1, $2, now())
     ON CONFLICT (id) DO UPDATE SET date_key = excluded.date_key, fired = excluded.fired, updated_at = now()`,
    [dateKey, JSON.stringify(fired)]
  );
}

export default {
  initSchema,
  getEmployeeById,
  countEmployees,
  upsertEmployeeChat,
  upsertEmployeeFromSheet,
  insertCheckin,
  getTodayCheckinStatus,
  listOpeningReminderTargets,
  listClosingReminderTargets,
  insertProductionShiftEntries,
  insertTimeoffRequest,
  getTimeoffRequestById,
  updateTimeoffStatus,
  isAbsentOnDate,
  countTimeoffRequests,
  backfillTimeoffRequests,
  enqueueOutbox,
  getPendingOutbox,
  markOutboxSynced,
  markOutboxFailed,
  loadAllSessions,
  saveSession,
  loadSchedulerState,
  saveSchedulerState
};
