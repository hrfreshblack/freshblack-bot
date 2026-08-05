import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import db from './db.js';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. The bot now needs its own Postgres database to run — see docs/DEPLOYMENT.md.');
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbzbyROT7oVCMMjKgOaZutacWxzBy9BAmCGD-NVGaJhMb_43n8pi-7TjpItGih0YAzjjtw/exec';

const HRD_USER_ID = process.env.HRD_USER_ID || '357796447';
const ACCOUNTANT_USER_ID = process.env.ACCOUNTANT_USER_ID || '465734268';
const APPROVAL_CHAT_ID = process.env.APPROVAL_CHAT_ID || '-5036148503';

const SESSIONS_FILE = process.env.SESSIONS_FILE || path.join(process.cwd(), 'data', 'sessions.json');
const SCHEDULER_STATE_FILE = process.env.SCHEDULER_STATE_FILE || path.join(process.cwd(), 'data', 'scheduler-state.json');

const STATIONS = [
  'Автомат 1кг',
  'Фотосепаратор',
  'Ручне пакування',
  'Замішування кави',
  'Дріп станок',
  'Збірка дріпів',
  'Обсмажка',
  'Комірник'
];

app.use(express.text({ type: '*/*' }));

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, { retries = 2, baseDelayMs = 300 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error?.response?.status;
      const isRetryable = !status || status >= 500 || error.code === 'ECONNABORTED' || error.code === 'ECONNRESET';
      if (!isRetryable || attempt === retries) throw error;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw lastError;
}

async function telegram(method, payload) {
  try {
    const resp = await withRetry(() => axios.post(`${TELEGRAM_API}/${method}`, payload, {
      timeout: 20000
    }));
    return resp.data;
  } catch (error) {
    const errData = error?.response?.data || error?.message || error;

    // не вважаємо блокування бота критичною аварією
    if (error?.response?.status === 403) {
      console.warn(`${method} BLOCKED:`, JSON.stringify(errData));
      return { ok: false, blocked: true, error: errData };
    }

    console.error(`${method} ERROR:`, JSON.stringify(errData));
    return null;
  }
}

async function sendMessage(chatId, text, extra = {}) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra
  });
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  return telegram('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false
  });
}

// Живі дії бота (checkin, timeoff_request, production_shift,
// update_timeoff_status, upsert_employee_chat) більше НЕ йдуть сюди напряму —
// вони пишуться в локальну базу (миттєво) і чергою (outbox) прилітають в
// Таблицю у фоні через ці самі дії bridge. sendToAppsScript лишається для:
// 1) періодичної синхронізації читання (employees/timeoff_requests),
// 2) саме черги outbox, коли вона надсилає накопичені записи.
// retry: true — лише для читання; чергу outbox свідомо не обгортаємо
// повтором тут (щоб не здвоїти рядок, якщо запис фактично пройшов, а
// відповідь просто не дійшла) — вона й так retry'їться на наступному тіку.
async function sendToAppsScript(payload, { retry = false } = {}) {
  try {
    const doRequest = () => axios.post(APPS_SCRIPT_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    });
    const resp = retry ? await withRetry(doRequest) : await doRequest();
    return resp.data;
  } catch (error) {
    console.error('Apps Script ERROR:', JSON.stringify(error?.response?.data || error?.message || error));
    return { ok: false, error: error?.response?.data || error?.message || 'Bridge error' };
  }
}

// Записує в локальну базу і одразу повертає керування (не чекаючи Таблиці) —
// саме тому кнопки в боті тепер відповідають миттєво. Той самий payload іде
// в чергу outbox, звідки фоновий воркер (flushOutbox) занесе його в Google
// Таблицю окремо, без затримки для співробітника.
async function recordCheckin(payload) {
  await db.insertCheckin({ ...payload, kyiv_date: getTodayKeyKyiv() });
  await db.enqueueOutbox('checkin', payload);
}

async function recordProductionShift(payload) {
  const rows = (payload.entries || []).map((entry) => ({
    shift_id: payload.shift_id,
    opened_at: payload.opened_at,
    closed_at: payload.closed_at,
    employee_id: payload.employee_id,
    telegram_chat_id: payload.telegram_chat_id,
    telegram_user_id: payload.telegram_user_id,
    full_name: payload.full_name,
    station_name: entry.station_name,
    result_text: entry.result_text
  }));
  await db.insertProductionShiftEntries(rows);
  await db.enqueueOutbox('production_shift', payload);
}

const sessions = new Map();

function loadSessionsFromDisk() {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const obj = JSON.parse(raw || '{}');
    Object.entries(obj).forEach(([chatId, session]) => sessions.set(chatId, session));
    console.log(`Sessions restored from disk: ${sessions.size}`);
  } catch (error) {
    console.error('Failed to load sessions from disk:', error?.message || error);
  }
}

let sessionsSaveScheduled = false;
function persistSessionsToDisk() {
  if (sessionsSaveScheduled) return;
  sessionsSaveScheduled = true;
  setImmediate(() => {
    sessionsSaveScheduled = false;
    try {
      const dir = path.dirname(SESSIONS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj = Object.fromEntries(sessions);
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj));
    } catch (error) {
      console.error('Failed to persist sessions to disk:', error?.message || error);
    }
  });
}

function getSession(chatId) {
  return sessions.get(String(chatId));
}

function saveSession(chatId, session) {
  sessions.set(String(chatId), session);
  persistSessionsToDisk();
}

loadSessionsFromDisk();

function getKyivNowParts() {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });

  const parts = dtf.formatToParts(new Date());
  const out = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') out[p.type] = p.value;
  });

  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    weekday: out.weekday,
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second)
  };
}

function getTodayKeyKyiv() {
  const n = getKyivNowParts();
  return `${n.year}-${String(n.month).padStart(2, '0')}-${String(n.day).padStart(2, '0')}`;
}

function isWeekdayKyiv() {
  const wd = getKyivNowParts().weekday;
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(wd);
}

function getBotSleepMessage() {
  const now = getKyivNowParts();
  const minutes = now.hour * 60 + now.minute;

  if (minutes < 7 * 60 + 30) return 'Я ще сплю 😴';
  if (minutes >= 23 * 60) return 'Я стомився і сьогодні більше не працюю 🥱';
  return '';
}

function isPrivateChat(chatId) {
  return !String(chatId).startsWith('-');
}

function shouldBlockByTime(chatId) {
  return isPrivateChat(chatId);
}

function nowIso() {
  return new Date().toISOString();
}

function makeShiftId(employeeId) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `SHIFT-${employeeId}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function generateRequestId() {
  const n = getKyivNowParts();
  const pad = (v) => String(v).padStart(2, '0');
  const stamp = `${n.year}${pad(n.month)}${pad(n.day)}-${pad(n.hour)}${pad(n.minute)}${pad(n.second)}`;
  return `REQ-${stamp}-${Math.floor(Math.random() * 1000)}`;
}

function ukrDateToIso(str) {
  const m = String(str || '').trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Так само, як recordCheckin: пишемо локально й одразу продовжуємо, id
// заявки генерується тут же (він потрібен негайно — для кнопок
// погодження), Таблиця наздоганяє в фоні через ту саму чергу outbox.
async function recordTimeoffRequest(payload) {
  const requestId = generateRequestId();
  const row = {
    ...payload,
    request_id: requestId,
    date_from_iso: ukrDateToIso(payload.date_from),
    date_to_iso: ukrDateToIso(payload.date_to)
  };
  await db.insertTimeoffRequest(row);
  await db.enqueueOutbox('timeoff_request', { ...payload, request_id: requestId });
  return requestId;
}

async function applyTimeoffStatus(requestId, fields) {
  await db.updateTimeoffStatus(requestId, fields);
  await db.enqueueOutbox('update_timeoff_status', { request_id: requestId, ...fields });
}

function getMainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '🏢 Офіс', callback_data: 'entry_office' },
        { text: '🏭 Виробництво', callback_data: 'entry_production' }
      ],
      [
        { text: '📅 Подати запит', callback_data: 'timeoff_menu' }
      ]
    ]
  };
}

function getOfficeStartMenu() {
  return {
    inline_keyboard: [
      [{ text: '✅ Вхід', callback_data: 'office_start' }],
      [{ text: '⬅️ Назад', callback_data: 'back_main' }]
    ]
  };
}

function getOfficeFormatMenu() {
  return {
    inline_keyboard: [
      [
        { text: '🏢 Офіс', callback_data: 'office_format_office' },
        { text: '🏠 Віддалено', callback_data: 'office_format_remote' }
      ]
    ]
  };
}

function getOfficeExitMenu() {
  return {
    inline_keyboard: [
      [{ text: '🚪 Вихід', callback_data: 'office_checkout' }]
    ]
  };
}

function getProductionStartMenu() {
  return {
    inline_keyboard: [
      [{ text: '▶️ Почати зміну', callback_data: 'production_open_shift' }],
      [{ text: '⬅️ Назад', callback_data: 'back_main' }]
    ]
  };
}

function getStationMenu() {
  const rows = STATIONS.map((station, index) => [
    { text: station, callback_data: `station_${index}` }
  ]);
  rows.push([{ text: '✅ Завершити введення станцій', callback_data: 'production_finish_entries' }]);
  return { inline_keyboard: rows };
}

function getAddMoreStationMenu() {
  return {
    inline_keyboard: [
      [{ text: '➕ Додати ще станцію', callback_data: 'production_add_more_station' }],
      [{ text: '✅ Завершити введення станцій', callback_data: 'production_finish_entries' }]
    ]
  };
}

function getProductionCloseMenu() {
  return {
    inline_keyboard: [
      [{ text: '🏁 Закрити зміну', callback_data: 'production_close_shift' }]
    ]
  };
}

function getTimeoffMenu() {
  return {
    inline_keyboard: [
      [{ text: '🏖 Щорічна відпустка', callback_data: 'vacation_annual' }],
      [{ text: '💸 За свій рахунок', callback_data: 'vacation_unpaid' }],
      [{ text: '🤒 Лікарняний', callback_data: 'sick' }],
      [{ text: '⬅️ Назад', callback_data: 'back_main' }]
    ]
  };
}

function getHrdApprovalMenu(requestId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Погодити HRD', callback_data: `hr_approve:${requestId}` },
        { text: '❌ Відхилити HRD', callback_data: `hr_reject:${requestId}` }
      ]
    ]
  };
}

function getAccountantApprovalMenu(requestId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Погодити бухгалтер', callback_data: `acc_approve:${requestId}` },
        { text: '❌ Відхилити бухгалтер', callback_data: `acc_reject:${requestId}` }
      ]
    ]
  };
}

function parseDate(dateStr) {
  const m = String(dateStr).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;

  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);

  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;

  return dt;
}

function parseDateRangeText(text) {
  const m = String(text).match(/^\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})\s*$/);
  if (!m) return null;

  const d1 = parseDate(m[1]);
  const d2 = parseDate(m[2]);
  if (!d1 || !d2 || d2 < d1) return null;

  return {
    date_from: m[1],
    date_to: m[2]
  };
}

function displayRequesterName(req) {
  return req.full_name || req.employee_id || 'співробітник';
}

function displayRequestType(req) {
  if (req.request_type === 'sick') return 'Лікарняний';
  if (req.request_type === 'vacation' && req.request_subtype === 'unpaid') return 'Відпустка за свій рахунок';
  if (req.request_type === 'vacation') return 'Щорічна відпустка';
  return req.request_type || 'Запит';
}

// Усі перевірки нижче раніше йшли в Google Таблицю через Apps Script (кожна
// — окремий мережевий round-trip у сотні мілісекунд-секунди, і що більше
// накопичувалось рядків у checkins/timeoff_requests, то повільніше). Тепер
// вони читають локальну Postgres-базу бота (мілісекунди), а в Таблицю дані
// потрапляють окремо, у фоні (див. enqueueOutbox нижче). Форма відповіді
// (`{ result: {...} }`) лишена такою ж, як була в sendToAppsScript, щоб не
// чіпати виклики нижче по коду.

function identityFromSession(sessionOrEmp) {
  return {
    employee_id: sessionOrEmp.employee_id || '',
    telegram_chat_id: sessionOrEmp.telegram_chat_id || '',
    telegram_user_id: sessionOrEmp.telegram_user_id || '',
    full_name: String(sessionOrEmp.full_name || '').trim().toLowerCase()
  };
}

async function getDailyStatus(sessionOrEmp) {
  const result = await db.getTodayCheckinStatus(identityFromSession(sessionOrEmp), getTodayKeyKyiv());
  return { result };
}

async function getDayContext(sessionOrEmp) {
  const identity = identityFromSession(sessionOrEmp);
  const today = getTodayKeyKyiv();
  const [dailyStatus, absence] = await Promise.all([
    db.getTodayCheckinStatus(identity, today),
    db.isAbsentOnDate(identity, today)
  ]);

  return {
    result: {
      has_any: dailyStatus.has_any,
      has_in: dailyStatus.has_in,
      has_out: dailyStatus.has_out,
      last_entry_type: dailyStatus.last_entry_type,
      last_work_format: dailyStatus.last_work_format,
      absent: absence.absent,
      absent_reason: absence.reason
    }
  };
}

async function notifyHrdForApproval(requestId) {
  const req = await db.getTimeoffRequestById(requestId);
  if (!req) return;

  let text =
    `📝 <b>Потрібне погодження HRD</b>\n` +
    `Тип: ${displayRequestType(req)}\n` +
    `Працівник: ${displayRequesterName(req)}\n` +
    `Період: ${req.date_from || ''} - ${req.date_to || ''}`;

  if (req.replacement_person) text += `\nЗаміщає: ${req.replacement_person}`;
  if (req.comment) text += `\nКоментар: ${req.comment}`;

  const msg = await sendMessage(APPROVAL_CHAT_ID, text, {
    reply_markup: getHrdApprovalMenu(requestId)
  });

  const messageId = msg?.result?.message_id;
  if (messageId) {
    await db.updateTimeoffStatus(requestId, { hr_message_id: String(messageId) });
    await db.enqueueOutbox('update_timeoff_status', { request_id: requestId, hr_message_id: String(messageId) });
  }
}

async function notifyAccountantForApproval(requestId) {
  const req = await db.getTimeoffRequestById(requestId);
  if (!req) return;

  let text =
    `💼 <b>Потрібне погодження головного бухгалтера</b>\n` +
    `Тип: ${displayRequestType(req)}\n` +
    `Працівник: ${displayRequesterName(req)}\n` +
    `Період: ${req.date_from || ''} - ${req.date_to || ''}`;

  if (req.replacement_person) text += `\nЗаміщає: ${req.replacement_person}`;
  if (req.comment) text += `\nКоментар: ${req.comment}`;

  const msg = await sendMessage(APPROVAL_CHAT_ID, text, {
    reply_markup: getAccountantApprovalMenu(requestId)
  });

  const messageId = msg?.result?.message_id;
  if (messageId) {
    await db.updateTimeoffStatus(requestId, { accountant_message_id: String(messageId) });
    await db.enqueueOutbox('update_timeoff_status', {
      request_id: requestId,
      accountant_message_id: String(messageId),
      notified_finance: 'yes'
    });
  }
}

// Надсилає повідомлення багатьом людям паралельно (обмеженою кількістю
// одночасних відправок), замість повністю послідовного циклу з паузою.
// Одна людина, що заблокувала бота чи має проблему з мережею, більше не
// сповільнює розсилку всім іншим.
async function sendToManyInBatches(items, sendFn, concurrency = 20) {
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = items[index++];
      try {
        await sendFn(current);
      } catch (error) {
        console.error('Reminder send failed:', error?.message || error);
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length) || 0;
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
}

async function sendOpeningReminderBatch(isSecondReminder = false) {
  const employees = await db.listOpeningReminderTargets(getTodayKeyKyiv());

  const text = isSecondReminder
    ? '⏰ Друге нагадування: ти ще не почав(ла) робочий день у боті.'
    : '⏰ Нагадування: почни робочий день у боті.';

  await sendToManyInBatches(employees, (emp) => sendMessage(emp.telegram_chat_id, text));
}

async function sendProductionClosingReminderBatch() {
  const employees = await db.listClosingReminderTargets('production', getTodayKeyKyiv());

  await sendToManyInBatches(employees, (emp) => sendMessage(
    emp.telegram_chat_id,
    '🔔 Час закрити зміну.\nПодай звіт за зміну та обери станції.',
    { reply_markup: getStationMenu() }
  ));
}

async function sendOfficeClosingReminderBatch(isSecondReminder = false) {
  const employees = await db.listClosingReminderTargets('office', getTodayKeyKyiv());

  const text = isSecondReminder
    ? '⏰ Ти забув завершити робочий день.'
    : '🔔 Не забудь завершити робочий день.';

  await sendToManyInBatches(employees, (emp) => sendMessage(emp.telegram_chat_id, text, {
    reply_markup: getOfficeExitMenu()
  }));
}

// Розклад нагадувань. Кожен слот спрацьовує РІВНО один раз на добу, як тільки
// поточний час його досягнув (а не лише в точну хвилину, як було раніше) —
// тож затримка event loop саме на потрібній хвилині більше не "з'їдає" ціле
// нагадування на весь день.
const REMINDER_SCHEDULE = [
  { id: 'opening_1', minutes: 8 * 60 + 30, run: () => sendOpeningReminderBatch(false) },
  { id: 'opening_2', minutes: 9 * 60 + 30, run: () => sendOpeningReminderBatch(true) },
  { id: 'production_close', minutes: 17 * 60 + 45, run: () => sendProductionClosingReminderBatch() },
  { id: 'office_close_1', minutes: 18 * 60, run: () => sendOfficeClosingReminderBatch(false) },
  { id: 'office_close_2', minutes: 19 * 60 + 30, run: () => sendOfficeClosingReminderBatch(true) }
];

let firedToday = new Set();
let firedDateKey = '';

function loadSchedulerState() {
  try {
    if (!fs.existsSync(SCHEDULER_STATE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SCHEDULER_STATE_FILE, 'utf8') || '{}');
    firedDateKey = raw.dateKey || '';
    firedToday = new Set(raw.fired || []);
  } catch (error) {
    console.error('Failed to load scheduler state:', error?.message || error);
  }
}

function persistSchedulerState() {
  try {
    const dir = path.dirname(SCHEDULER_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SCHEDULER_STATE_FILE, JSON.stringify({
      dateKey: firedDateKey,
      fired: Array.from(firedToday)
    }));
  } catch (error) {
    console.error('Failed to persist scheduler state:', error?.message || error);
  }
}

loadSchedulerState();

async function schedulerTick() {
  try {
    if (!isWeekdayKyiv()) return;

    const now = getKyivNowParts();
    const todayKey = getTodayKeyKyiv();
    const nowMinutes = now.hour * 60 + now.minute;

    if (todayKey !== firedDateKey) {
      firedDateKey = todayKey;
      firedToday = new Set();
    }

    for (const slot of REMINDER_SCHEDULE) {
      if (firedToday.has(slot.id)) continue;
      if (nowMinutes < slot.minutes) continue;

      firedToday.add(slot.id);
      persistSchedulerState();
      await slot.run();
    }
  } catch (error) {
    console.error('schedulerTick ERROR:', error?.stack || error?.message || error);
  }
}

setInterval(() => {
  schedulerTick();
}, 60000);

// Періодично тягне employees з Таблиці в локальну базу (лише full_name і
// active — telegram_chat_id/telegram_user_id залишаються місцевими, бот сам
// їх записує через upsertEmployeeChat і ніколи не перезаписує їх звідси).
// Це дає змогу HR редагувати список співробітників у Таблиці як і раніше.
async function syncEmployeesFromSheet() {
  const resp = await sendToAppsScript({ action: 'list_all_employees' }, { retry: true });
  const employees = resp?.result?.employees || [];
  for (const emp of employees) {
    await db.upsertEmployeeFromSheet(emp.employee_id, emp.full_name, emp.active !== false);
  }
}

// Одноразово (лише якщо локальна база порожня) підтягує вже наявні заявки на
// відпустку/лікарняний з Таблиці — щоб уже подані/погоджені заявки одразу
// враховувались у перевірках відсутності після переходу на нову архітектуру,
// а не тільки ті, що подані заново.
async function backfillTimeoffRequestsIfNeeded() {
  const existing = await db.countTimeoffRequests();
  if (existing > 0) return;

  const resp = await sendToAppsScript({ action: 'list_all_timeoff_requests' }, { retry: true });
  const requests = resp?.result?.requests || [];
  if (requests.length) await db.backfillTimeoffRequests(requests);
}

// Черга записів, які ще треба донести в Google Таблицю (checkin,
// timeoff_request, production_shift, update_timeoff_status,
// upsert_employee_chat) — заповнюється миттєво в момент дії користувача,
// а сюди фоново "здогонятиметься" без затримки для співробітника. Якщо
// Apps Script тимчасово недоступний — рядки лишаються в черзі й підуть
// наступного тіку, нічого не губиться.
let outboxFlushInProgress = false;
async function flushOutbox() {
  if (outboxFlushInProgress) return;
  outboxFlushInProgress = true;
  try {
    const batch = await db.getPendingOutbox(20);
    for (const row of batch) {
      try {
        const resp = await sendToAppsScript({ action: row.action, ...row.payload });
        if (resp?.ok) {
          await db.markOutboxSynced(row.id);
        } else {
          await db.markOutboxFailed(row.id, JSON.stringify(resp?.error || 'unknown error'));
        }
      } catch (error) {
        await db.markOutboxFailed(row.id, error?.message || error);
      }
    }
  } catch (error) {
    console.error('flushOutbox ERROR:', error?.stack || error?.message || error);
  } finally {
    outboxFlushInProgress = false;
  }
}

setInterval(() => {
  flushOutbox();
}, 5000);

setInterval(() => {
  syncEmployeesFromSheet().catch((error) => console.error('syncEmployeesFromSheet ERROR:', error?.message || error));
}, 5 * 60 * 1000);

app.get('/', (_req, res) => {
  res.status(200).send('Bot is running');
});

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.post('/webhook', async (req, res) => {
  if (WEBHOOK_SECRET) {
    const provided = req.get('X-Telegram-Bot-Api-Secret-Token');
    if (provided !== WEBHOOK_SECRET) {
      res.sendStatus(401);
      return;
    }
  }

  res.sendStatus(200);

  try {
    const rawBody = req.body || '{}';
    const update = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

    if (update.message) {
      const msg = update.message;
      const chatId = String(msg.chat.id);
      const fromUserId = String(msg.from?.id || '');
      const text = (msg.text || '').trim();

      if (shouldBlockByTime(chatId)) {
        const sleepMsg = getBotSleepMessage();
        if (sleepMsg) {
          await sendMessage(chatId, sleepMsg);
          return;
        }
      }

      if (/^\/ping$/i.test(text)) {
        await sendMessage(chatId, 'pong ✅');
        return;
      }

      if (/^\/start/i.test(text)) {
        const m = text.match(/^\/start\s+([A-Za-z0-9\-_]+)/i);
        const employeeId = m ? String(m[1]).trim() : '';

        if (!employeeId) {
          await sendMessage(chatId, '⚠️ Не знайдено код співробітника. Відскануйте QR ще раз.');
          return;
        }

        // Спершу дивимось у локальній базі (миттєво). Якщо співробітника там
        // ще немає — це або новий QR, або ще не наздогнала періодична
        // синхронізація зі Таблицею (раз на 5 хв) — тоді один раз звертаємось
        // напряму до Apps Script як запасний варіант.
        let employee = await db.getEmployeeById(employeeId);

        if (!employee) {
          const empResp = await sendToAppsScript({
            action: 'get_employee',
            employee_id: employeeId
          }, { retry: true });

          if (!empResp?.ok || !empResp?.result?.found) {
            await sendMessage(chatId, '⚠️ Співробітника не знайдено в таблиці employees.');
            return;
          }

          employee = { employee_id: employeeId, full_name: empResp.result.full_name || '' };
        }

        await db.upsertEmployeeChat(employeeId, employee.full_name || '', chatId, fromUserId);
        await db.enqueueOutbox('upsert_employee_chat', {
          employee_id: employeeId,
          telegram_chat_id: chatId,
          telegram_user_id: fromUserId
        });

        saveSession(chatId, {
          employee_id: employeeId,
          full_name: employee.full_name || '',
          telegram_chat_id: chatId,
          telegram_user_id: fromUserId,
          current_branch: null,
          checked_in: false,
          entry_type: '',
          work_format: '',
          remote_reason: '',
          awaiting_remote_reason: false,
          production_shift_open: false,
          production_shift_id: '',
          production_opened_at: '',
          awaiting_station_result: false,
          current_station_name: '',
          production_entries: [],
          timeoff_flow: null,
          timeoff_step: null,
          request_type: '',
          request_subtype: '',
          date_from: '',
          date_to: '',
          _last_action: '',
          _last_action_ts: 0
        });

        await sendMessage(chatId, `👋 Вітаю, <b>${employee.full_name || ''}</b>.\nОберіть напрям роботи:`, {
          reply_markup: getMainMenu()
        });
        return;
      }

      const session = getSession(chatId);

      if (!session) {
        await sendMessage(chatId, '⚠️ Спочатку відкрийте бота через ваш персональний QR.');
        return;
      }

      session.telegram_user_id = fromUserId || session.telegram_user_id;
      session.telegram_chat_id = chatId;
      saveSession(chatId, session);

      if (session.awaiting_remote_reason) {
        const dayStatusResp = await getDailyStatus(session);
        const dayStatus = dayStatusResp?.result || {};

        if (dayStatus.has_in) {
          session.awaiting_remote_reason = false;
          saveSession(chatId, session);
          await sendMessage(chatId, 'Дякую. Сьогодні вхід вже зафіксовано.');
          return;
        }

        if (dayStatus.has_out) {
          session.awaiting_remote_reason = false;
          saveSession(chatId, session);
          await sendMessage(chatId, 'Сьогодні вихід уже зафіксовано.');
          return;
        }

        const reason = text;
        session.awaiting_remote_reason = false;
        session.remote_reason = reason;
        session.checked_in = true;
        session.entry_type = 'office';
        session.work_format = 'remote';
        saveSession(chatId, session);

        await recordCheckin({
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          telegram_user_id: session.telegram_user_id,
          full_name: session.full_name,
          type: 'in',
          mode: 'remote',
          note: 'railway',
          entry_type: 'office',
          work_format: 'remote',
          remote_reason: reason
        });

        await sendMessage(chatId, 'Дякую, робочий день розпочато. Вдалого дня 😉', {
          reply_markup: getOfficeExitMenu()
        });
        return;
      }

      if (session.awaiting_station_result && session.current_station_name) {
        session.awaiting_station_result = false;
        session.production_entries.push({
          station_name: session.current_station_name,
          result_text: text
        });
        session.current_station_name = '';
        saveSession(chatId, session);

        await sendMessage(chatId, '✅ Результат по станції записано.\nДодати ще одну станцію?', {
          reply_markup: getAddMoreStationMenu()
        });
        return;
      }

      if (session.timeoff_flow === 'vacation' && session.timeoff_step === 'dates') {
        const parsed = parseDateRangeText(text);
        if (!parsed) {
          await sendMessage(chatId, '⚠️ Невірний формат.\nНадішліть так:\n<code>15.04.2026 - 17.04.2026</code>');
          return;
        }

        session.date_from = parsed.date_from;
        session.date_to = parsed.date_to;
        session.timeoff_step = 'replacement';
        saveSession(chatId, session);

        await sendMessage(chatId, 'Хто заміняє? Напишіть ім’я та прізвище.');
        return;
      }

      if (session.timeoff_flow === 'vacation' && session.timeoff_step === 'replacement') {
        const replacementPerson = text;
        const dateFrom = session.date_from;
        const dateTo = session.date_to;
        const subtype = session.request_subtype;

        const requestId = await recordTimeoffRequest({
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          telegram_user_id: session.telegram_user_id,
          full_name: session.full_name,
          request_type: 'vacation',
          request_subtype: subtype,
          date_from: dateFrom,
          date_to: dateTo,
          replacement_person: replacementPerson,
          replacement_contact: '',
          comment: ''
        });

        session.timeoff_flow = null;
        session.timeoff_step = null;
        session.request_subtype = '';
        session.date_from = '';
        session.date_to = '';
        saveSession(chatId, session);

        const subtypeLabel = subtype === 'unpaid' ? 'За свій рахунок' : 'Щорічна';
        await sendMessage(
          chatId,
          `✅ Заявку на відпустку створено.\nТип: ${subtypeLabel}\nПеріод: ${dateFrom} - ${dateTo}\nЗаміщає: ${replacementPerson}\n\nСтатус: очікує погодження`
        );

        await notifyHrdForApproval(requestId);
        return;
      }

      if (session.timeoff_flow === 'sick' && session.timeoff_step === 'dates') {
        const parsed = parseDateRangeText(text);
        if (!parsed) {
          await sendMessage(chatId, '⚠️ Невірний формат.\nНадішліть так:\n<code>18.04.2026 - 20.04.2026</code>');
          return;
        }

        session.date_from = parsed.date_from;
        session.date_to = parsed.date_to;
        session.timeoff_step = 'comment';
        saveSession(chatId, session);

        await sendMessage(chatId, 'Вкажіть коментар / причину лікарняного.');
        return;
      }

      if (session.timeoff_flow === 'sick' && session.timeoff_step === 'comment') {
        const comment = text;
        const dateFrom = session.date_from;
        const dateTo = session.date_to;

        const requestId = await recordTimeoffRequest({
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          telegram_user_id: session.telegram_user_id,
          full_name: session.full_name,
          request_type: 'sick',
          request_subtype: '',
          date_from: dateFrom,
          date_to: dateTo,
          replacement_person: '',
          replacement_contact: '',
          comment: comment
        });

        session.timeoff_flow = null;
        session.timeoff_step = null;
        session.date_from = '';
        session.date_to = '';
        saveSession(chatId, session);

        await sendMessage(
          chatId,
          `✅ Заявку на лікарняний створено.\nПеріод: ${dateFrom} - ${dateTo}\n\nСтатус: очікує погодження`
        );

        await notifyHrdForApproval(requestId);
        return;
      }

      await sendMessage(chatId, 'Поки що використовуйте кнопки в меню.');
      return;
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const callbackId = cq.id;
      const chatId = String(cq.message.chat.id);
      const fromUserId = String(cq.from?.id || '');
      const data = cq.data || '';

      if (!data.startsWith('hr_') && !data.startsWith('acc_') && shouldBlockByTime(chatId)) {
        const sleepMsg = getBotSleepMessage();
        if (sleepMsg) {
          await answerCallbackQuery(callbackId, sleepMsg);
          await sendMessage(chatId, sleepMsg);
          return;
        }
      }

      await answerCallbackQuery(callbackId);

      if (data.startsWith('hr_approve:') || data.startsWith('hr_reject:')) {
        if (fromUserId !== HRD_USER_ID) {
          await answerCallbackQuery(callbackId, 'Це погодження доступне лише HRD');
          return;
        }

        const requestId = data.split(':')[1];
        const req = await db.getTimeoffRequestById(requestId);

        if (!req) {
          await sendMessage(chatId, '⚠️ Заявку не знайдено.');
          return;
        }

        const approverName = [cq.from?.first_name || '', cq.from?.last_name || ''].join(' ').trim() || 'HRD';

        if (data.startsWith('hr_reject:')) {
          await applyTimeoffStatus(requestId, {
            status: 'rejected',
            status_hr: 'rejected',
            final_status: 'rejected',
            approved_by_hrd: approverName,
            approved_at_hrd: nowIso()
          });

          if (req.telegram_chat_id) {
            await sendMessage(req.telegram_chat_id, '❌ Вашу заявку відхилено HRD.');
          }

          await sendMessage(chatId, `HRD відхилив(ла) заявку ${requestId}.`);
          return;
        }

        await applyTimeoffStatus(requestId, {
          status: 'pending_accountant',
          status_hr: 'approved',
          final_status: 'pending_accountant',
          approved_by_hrd: approverName,
          approved_at_hrd: nowIso()
        });

        if (req.telegram_chat_id) {
          if (req.request_type === 'vacation') {
            await sendMessage(req.telegram_chat_id, 'HRD відпустку погодила. Напиши заяву у головного бухгалтера.');
          } else {
            await sendMessage(req.telegram_chat_id, 'HRD лікарняний погодила. Очікуй фінальне погодження.');
          }
        }

        await sendMessage(chatId, `HRD погодив(ла) заявку ${requestId}. Передаю головному бухгалтеру.`);
        await notifyAccountantForApproval(requestId);
        return;
      }

      if (data.startsWith('acc_approve:') || data.startsWith('acc_reject:')) {
        if (fromUserId !== ACCOUNTANT_USER_ID) {
          await answerCallbackQuery(callbackId, 'Це погодження доступне лише головному бухгалтеру');
          return;
        }

        const requestId = data.split(':')[1];
        const req = await db.getTimeoffRequestById(requestId);

        if (!req) {
          await sendMessage(chatId, '⚠️ Заявку не знайдено.');
          return;
        }

        const approverName = [cq.from?.first_name || '', cq.from?.last_name || ''].join(' ').trim() || 'Головний бухгалтер';

        if (data.startsWith('acc_reject:')) {
          await applyTimeoffStatus(requestId, {
            status: 'rejected',
            status_chief_acc: 'rejected',
            final_status: 'rejected',
            approved_by_accountant: approverName,
            approved_at_accountant: nowIso()
          });

          if (req.telegram_chat_id) {
            await sendMessage(req.telegram_chat_id, '❌ Заявку не погоджено головним бухгалтером.');
          }

          await sendMessage(chatId, `Головний бухгалтер відхилив(ла) заявку ${requestId}.`);
          return;
        }

        await applyTimeoffStatus(requestId, {
          status: 'approved',
          status_chief_acc: 'approved',
          final_status: 'approved',
          approved_by_accountant: approverName,
          approved_at_accountant: nowIso()
        });

        if (req.telegram_chat_id) {
          if (req.request_type === 'vacation') {
            await sendMessage(req.telegram_chat_id, 'Відпустку погоджено остаточно.');
          } else {
            await sendMessage(req.telegram_chat_id, 'Лікарняний погоджено остаточно.');
          }
        }

        await sendMessage(chatId, `Головний бухгалтер погодив(ла) заявку ${requestId}.`);
        return;
      }

      const session = getSession(chatId);

      if (!session) {
        await sendMessage(chatId, '⚠️ Спочатку відкрийте бота через ваш персональний QR.');
        return;
      }

      // антидубль callback
      const nowTs = Date.now();
      if (session._last_action === data && nowTs - (session._last_action_ts || 0) < 2000) {
        return;
      }
      session._last_action = data;
      session._last_action_ts = nowTs;

      session.telegram_user_id = fromUserId || session.telegram_user_id;
      session.telegram_chat_id = chatId;
      saveSession(chatId, session);

      if (data === 'back_main') {
        session.timeoff_flow = null;
        session.timeoff_step = null;
        session.awaiting_remote_reason = false;
        session.awaiting_station_result = false;
        session.current_station_name = '';
        saveSession(chatId, session);

        await sendMessage(chatId, `👋 Вітаю, <b>${session.full_name}</b>.\nОберіть напрям роботи:`, {
          reply_markup: getMainMenu()
        });
        return;
      }

      if (data === 'entry_office') {
        session.current_branch = 'office';
        saveSession(chatId, session);

        await sendMessage(chatId, 'Офісний напрям.\nНатисніть Вхід.', {
          reply_markup: getOfficeStartMenu()
        });
        return;
      }

      if (data === 'entry_production') {
        session.current_branch = 'production';
        saveSession(chatId, session);

        await sendMessage(chatId, 'Виробництво.\nНатисніть Почати зміну.', {
          reply_markup: getProductionStartMenu()
        });
        return;
      }

      if (data === 'office_start') {
        const ctxResp = await getDayContext(session);
        const ctx = ctxResp?.result || {};

        if (ctx.absent) {
          await sendMessage(chatId, 'Ти зараз у відпустці або на лікарняному 😉');
          return;
        }

        if (ctx.has_in) {
          await sendMessage(chatId, 'Дякую. Сьогодні вхід вже зафіксовано.');
          return;
        }

        if (ctx.has_out) {
          await sendMessage(chatId, 'Сьогодні вихід уже зафіксовано.');
          return;
        }

        await sendMessage(chatId, 'Оберіть формат роботи:', {
          reply_markup: getOfficeFormatMenu()
        });
        return;
      }

      if (data === 'office_format_office') {
        const dayStatusResp = await getDailyStatus(session);
        const dayStatus = dayStatusResp?.result || {};

        if (dayStatus.has_in) {
          await sendMessage(chatId, 'Дякую. Сьогодні вхід вже зафіксовано.');
          return;
        }

        if (dayStatus.has_out) {
          await sendMessage(chatId, 'Сьогодні вихід уже зафіксовано.');
          return;
        }

        await recordCheckin({
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          telegram_user_id: session.telegram_user_id,
          full_name: session.full_name,
          type: 'in',
          mode: 'office',
          note: 'railway',
          entry_type: 'office',
          work_format: 'office',
          remote_reason: ''
        });

        session.checked_in = true;
        session.entry_type = 'office';
        session.work_format = 'office';
        saveSession(chatId, session);

        await sendMessage(chatId, 'Дякую, робочий день розпочато. Вдалого дня 😉', {
          reply_markup: getOfficeExitMenu()
        });
        return;
      }

      if (data === 'office_format_remote') {
        const dayStatusResp = await getDailyStatus(session);
        const dayStatus = dayStatusResp?.result || {};

        if (dayStatus.has_in) {
          await sendMessage(chatId, 'Дякую. Сьогодні вхід вже зафіксовано.');
          return;
        }

        if (dayStatus.has_out) {
          await sendMessage(chatId, 'Сьогодні вихід уже зафіксовано.');
          return;
        }

        session.awaiting_remote_reason = true;
        saveSession(chatId, session);

        await sendMessage(chatId, 'Оберіть причину віддаленої роботи:\n• Працюю на виїзді\n• За погодженням із керівником');
        return;
      }

      if (data === 'office_checkout') {
        const dayStatusResp = await getDailyStatus(session);
        const dayStatus = dayStatusResp?.result || {};

        if (!dayStatus.has_in) {
          await sendMessage(chatId, 'Звернись до HRD.');
          return;
        }

        if (dayStatus.has_out) {
          await sendMessage(chatId, 'Сьогодні вихід уже зафіксовано.');
          return;
        }

        await recordCheckin({
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          telegram_user_id: session.telegram_user_id,
          full_name: session.full_name,
          type: 'out',
          mode: '',
          note: 'railway',
          entry_type: 'office',
          work_format: session.work_format || '',
          remote_reason: session.remote_reason || ''
        });

        session.checked_in = false;
        session.entry_type = '';
        session.work_format = '';
        session.remote_reason = '';
        saveSession(chatId, session);

        await sendMessage(chatId, 'Вихід зафіксовано. Гарного вечора 🤗');
        return;
      }

      if (data === 'production_open_shift') {
        const ctxResp = await getDayContext(session);
        const ctx = ctxResp?.result || {};

        if (ctx.absent) {
          await sendMessage(chatId, 'Ти зараз у відпустці або на лікарняному 😉');
          return;
        }

        if (ctx.has_in) {
          await sendMessage(chatId, 'Дякую. Сьогодні вхід вже зафіксовано.');
          return;
        }

        if (ctx.has_out) {
          await sendMessage(chatId, 'Сьогодні вихід уже зафіксовано.');
          return;
        }

        await recordCheckin({
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          telegram_user_id: session.telegram_user_id,
          full_name: session.full_name,
          type: 'in',
          mode: 'production',
          note: 'railway',
          entry_type: 'production',
          work_format: 'production',
          remote_reason: ''
        });

        session.checked_in = true;
        session.production_shift_open = true;
        session.entry_type = 'production';
        session.work_format = 'production';
        if (!session.production_shift_id) {
          session.production_shift_id = makeShiftId(session.employee_id);
        }
        session.production_opened_at = nowIso();
        session.production_entries = [];
        saveSession(chatId, session);

        await sendMessage(chatId, 'Зміну розпочато. Вдалого дня 😉');
        return;
      }

      if (data.startsWith('station_')) {
        if (!session.production_shift_open) {
          await sendMessage(chatId, '⚠️ Спочатку почни зміну.');
          return;
        }

        const idx = Number(data.replace('station_', ''));
        const stationName = STATIONS[idx];

        if (!stationName) {
          await sendMessage(chatId, '⚠️ Невідома станція.');
          return;
        }

        session.current_station_name = stationName;
        session.awaiting_station_result = true;
        saveSession(chatId, session);

        await sendMessage(chatId, `Вкажіть результат роботи по станції:\n<b>${stationName}</b>`);
        return;
      }

      if (data === 'production_add_more_station') {
        await sendMessage(chatId, 'Оберіть наступну станцію:', {
          reply_markup: getStationMenu()
        });
        return;
      }

      if (data === 'production_finish_entries') {
        if (!session.production_entries?.length) {
          await sendMessage(chatId, '⚠️ Спочатку додайте хоча б одну станцію та результат.');
          return;
        }

        await sendMessage(chatId, 'Дякую, дані записано.\nНатисніть Закрити зміну.', {
          reply_markup: getProductionCloseMenu()
        });
        return;
      }

      if (data === 'production_close_shift') {
        if (!session.production_shift_open) {
          await sendMessage(chatId, 'Звернись до HRD.');
          return;
        }

        const dayStatusResp = await getDailyStatus(session);
        const dayStatus = dayStatusResp?.result || {};

        if (!dayStatus.has_in) {
          await sendMessage(chatId, 'Звернись до HRD.');
          return;
        }

        if (dayStatus.has_out) {
          await sendMessage(chatId, 'Сьогодні вихід уже зафіксовано.');
          return;
        }

        if (!session.production_entries?.length) {
          await sendMessage(chatId, '⚠️ Немає жодного результату по станціях.');
          return;
        }

        const closedAt = nowIso();

        await recordProductionShift({
          shift_id: session.production_shift_id,
          opened_at: session.production_opened_at,
          closed_at: closedAt,
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          telegram_user_id: session.telegram_user_id,
          full_name: session.full_name,
          entries: session.production_entries
        });

        await recordCheckin({
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          telegram_user_id: session.telegram_user_id,
          full_name: session.full_name,
          type: 'out',
          mode: '',
          note: 'railway',
          entry_type: 'production',
          work_format: 'production',
          remote_reason: ''
        });

        session.checked_in = false;
        session.production_shift_open = false;
        session.entry_type = '';
        session.work_format = '';
        session.production_shift_id = '';
        session.production_opened_at = '';
        session.production_entries = [];
        session.awaiting_station_result = false;
        session.current_station_name = '';
        saveSession(chatId, session);

        await sendMessage(chatId, 'Зміну завершено. Гарного вечора 🤗');
        return;
      }

      if (data === 'timeoff_menu') {
        await sendMessage(chatId, 'Оберіть тип запиту:', {
          reply_markup: getTimeoffMenu()
        });
        return;
      }

      if (data === 'vacation_annual') {
        session.timeoff_flow = 'vacation';
        session.timeoff_step = 'dates';
        session.request_type = 'vacation';
        session.request_subtype = 'annual';
        saveSession(chatId, session);

        await sendMessage(chatId, 'Щорічна відпустка.\nВкажіть період у форматі:\n<code>15.04.2026 - 17.04.2026</code>');
        return;
      }

      if (data === 'vacation_unpaid') {
        session.timeoff_flow = 'vacation';
        session.timeoff_step = 'dates';
        session.request_type = 'vacation';
        session.request_subtype = 'unpaid';
        saveSession(chatId, session);

        await sendMessage(chatId, 'Відпустка за свій рахунок.\nВкажіть період у форматі:\n<code>15.04.2026 - 17.04.2026</code>');
        return;
      }

      if (data === 'sick') {
        session.timeoff_flow = 'sick';
        session.timeoff_step = 'dates';
        session.request_type = 'sick';
        session.request_subtype = '';
        saveSession(chatId, session);

        await sendMessage(chatId, 'Лікарняний.\nВкажіть період у форматі:\n<code>18.04.2026 - 20.04.2026</code>');
        return;
      }
    }
  } catch (error) {
    console.error('WEBHOOK ERROR:', error?.stack || error?.message || error);
  }
});

(async () => {
  try {
    await db.initSchema();
    await syncEmployeesFromSheet();
    await backfillTimeoffRequestsIfNeeded();
  } catch (error) {
    console.error('Startup DB init ERROR:', error?.stack || error?.message || error);
    process.exit(1);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server started on port ${PORT}`);
  });
})();
