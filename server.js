import express from 'express';
import axios from 'axios';

const app = express();
const PORT = 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwuo1uepXZcJ9pL1J2CyMaHRGLmeGJBzJjJ4JQAIaGVp95A6RiDTrVY3jPCy-_yMUejNQ/exec';

const HRD_USER_ID = '357796447';
const ACCOUNTANT_USER_ID = '465734268';
const APPROVAL_CHAT_ID = '-5036148503';

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

async function telegram(method, payload) {
  try {
    const resp = await axios.post(`${TELEGRAM_API}/${method}`, payload, {
      timeout: 20000
    });
    return resp.data;
  } catch (error) {
    console.error(`${method} ERROR:`, JSON.stringify(error?.response?.data || error?.message || error));
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

async function sendToAppsScript(payload) {
  try {
    const resp = await axios.post(APPS_SCRIPT_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 20000
    });
    return resp.data;
  } catch (error) {
    console.error('Apps Script ERROR:', JSON.stringify(error?.response?.data || error?.message || error));
    return { ok: false, error: error?.response?.data || error?.message || 'Bridge error' };
  }
}

const sessions = new Map();

function getSession(chatId) {
  return sessions.get(String(chatId));
}

function saveSession(chatId, session) {
  sessions.set(String(chatId), session);
}

function getKyivNowParts() {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
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
    minute: Number(out.minute)
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

  if (minutes < 7 * 60) return 'Я ще сплю';
  if (minutes > 22 * 60 + 30) return 'Я стомився і сьогодні більше не працюю';
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
      [{ text: '▶️ Відкрити зміну', callback_data: 'production_open_shift' }],
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

async function notifyHrdForApproval(requestId) {
  const requestResp = await sendToAppsScript({
    action: 'get_timeoff_request',
    request_id: requestId
  });

  if (!requestResp || !requestResp.ok || !requestResp.result || !requestResp.result.found) return;

  const req = requestResp.result;

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
    await sendToAppsScript({
      action: 'update_timeoff_status',
      request_id: requestId,
      hr_message_id: String(messageId)
    });
  }
}

async function notifyAccountantForApproval(requestId) {
  const requestResp = await sendToAppsScript({
    action: 'get_timeoff_request',
    request_id: requestId
  });

  if (!requestResp || !requestResp.ok || !requestResp.result || !requestResp.result.found) return;

  const req = requestResp.result;

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
    await sendToAppsScript({
      action: 'update_timeoff_status',
      request_id: requestId,
      accountant_message_id: String(messageId),
      notified_finance: 'yes'
    });
  }
}

async function sendSecondOpeningReminderBatch(isSecondReminder = false) {
  const listResp = await sendToAppsScript({
    action: 'list_employees_for_opening_reminder'
  });

  const employees = listResp?.result?.employees || [];
  for (const emp of employees) {
    const statusResp = await sendToAppsScript({
      action: 'get_daily_checkin_status',
      employee_id: emp.employee_id
    });

    const s = statusResp?.result || {};
    if (s.has_any) continue;

    const text = isSecondReminder
      ? '⏰ Друге нагадування: ти ще не відкрив(ла) робочий день у боті.'
      : '⏰ Нагадування: відкрий робочий день у боті.';
    await sendMessage(emp.telegram_chat_id, text);
  }
}

async function sendClosingReminderBatch(entryType) {
  const listResp = await sendToAppsScript({
    action: 'list_open_shifts_for_closing_reminder',
    entry_type: entryType
  });

  const employees = listResp?.result?.employees || [];
  for (const emp of employees) {
    const text = entryType === 'office'
      ? '🔔 Нагадування: закрий робочий день у боті.'
      : '🔔 Нагадування: закрий зміну у боті.';
    await sendMessage(emp.telegram_chat_id, text);
  }
}

let lastSchedulerKey = '';

async function schedulerTick() {
  try {
    if (!isWeekdayKyiv()) return;

    const now = getKyivNowParts();
    const hhmm = `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`;
    const todayKey = getTodayKeyKyiv();
    const key = `${todayKey}-${hhmm}`;

    if (key === lastSchedulerKey) return;

    if (hhmm === '08:30') {
      lastSchedulerKey = key;
      await sendSecondOpeningReminderBatch(false);
      return;
    }

    if (hhmm === '09:30') {
      lastSchedulerKey = key;
      await sendSecondOpeningReminderBatch(true);
      return;
    }

    if (hhmm === '17:45') {
      lastSchedulerKey = key;
      await sendClosingReminderBatch('office');
      return;
    }

    if (hhmm === '18:00') {
      lastSchedulerKey = key;
      await sendClosingReminderBatch('production');
      return;
    }
  } catch (error) {
    console.error('schedulerTick ERROR:', error?.stack || error?.message || error);
  }
}

setInterval(() => {
  schedulerTick();
}, 60000);

app.get('/', (_req, res) => {
  res.status(200).send('Bot is running');
});

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const rawBody = req.body || '{}';
    const update = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

    // -------------------------
    // TEXT MESSAGES
    // -------------------------
    if (update.message) {
      const msg = update.message;
      const chatId = String(msg.chat.id);
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

        const empResp = await sendToAppsScript({
          action: 'get_employee',
          employee_id: employeeId
        });

        if (!empResp || !empResp.ok || !empResp.result || !empResp.result.found) {
          await sendMessage(chatId, '⚠️ Співробітника не знайдено в таблиці employees.');
          return;
        }

        saveSession(chatId, {
          employee_id: employeeId,
          full_name: empResp.result.full_name || '',
          telegram_chat_id: chatId,
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
          date_to: ''
        });

        await sendMessage(chatId, `👋 Вітаю, <b>${empResp.result.full_name || ''}</b>.\nОберіть напрям роботи:`, {
          reply_markup: getMainMenu()
        });
        return;
      }

      const session = getSession(chatId);

      if (!session) {
        await sendMessage(chatId, '⚠️ Спочатку відкрийте бота через ваш персональний QR.');
        return;
      }

      // Причина віддаленої роботи
      if (session.awaiting_remote_reason) {
        const reason = text;

        const dayStatusResp = await sendToAppsScript({
          action: 'get_daily_checkin_status',
          employee_id: session.employee_id
        });

        if (dayStatusResp?.result?.has_any) {
          session.awaiting_remote_reason = false;
          saveSession(chatId, session);
          await sendMessage(chatId, 'Звернись до HRD.');
          return;
        }

        session.awaiting_remote_reason = false;
        session.remote_reason = reason;
        session.checked_in = true;
        session.entry_type = 'office';
        session.work_format = 'remote';
        saveSession(chatId, session);

        const result = await sendToAppsScript({
          action: 'checkin',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          type: 'in',
          mode: 'remote',
          note: 'railway',
          entry_type: 'office',
          work_format: 'remote',
          remote_reason: reason
        });

        if (result && result.ok) {
          await sendMessage(chatId, '✅ Вхід зафіксовано.\nФормат роботи: Віддалено\nПричину записано.', {
            reply_markup: getOfficeExitMenu()
          });
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося записати вхід.');
        }
        return;
      }

      // Результат по станції
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

      // Відпустка: період
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

      // Відпустка: хто заміняє
      if (session.timeoff_flow === 'vacation' && session.timeoff_step === 'replacement') {
        const replacementPerson = text;
        const dateFrom = session.date_from;
        const dateTo = session.date_to;
        const subtype = session.request_subtype;

        const result = await sendToAppsScript({
          action: 'timeoff_request',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
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

        if (result && result.ok) {
          const subtypeLabel = subtype === 'unpaid' ? 'За свій рахунок' : 'Щорічна';
          await sendMessage(
            chatId,
            `✅ Заявку на відпустку створено.\nТип: ${subtypeLabel}\nПеріод: ${dateFrom} - ${dateTo}\nЗаміщає: ${replacementPerson}\n\nСтатус: очікує погодження`
          );
          if (result.result?.request_id) {
            await notifyHrdForApproval(result.result.request_id);
          }
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося створити заявку на відпустку.');
        }
        return;
      }

      // Лікарняний: період
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

      // Лікарняний: коментар
      if (session.timeoff_flow === 'sick' && session.timeoff_step === 'comment') {
        const comment = text;
        const dateFrom = session.date_from;
        const dateTo = session.date_to;

        const result = await sendToAppsScript({
          action: 'timeoff_request',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
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

        if (result && result.ok) {
          await sendMessage(
            chatId,
            `✅ Заявку на лікарняний створено.\nПеріод: ${dateFrom} - ${dateTo}\n\nСтатус: очікує погодження`
          );
          if (result.result?.request_id) {
            await notifyHrdForApproval(result.result.request_id);
          }
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося створити заявку на лікарняний.');
        }
        return;
      }

      await sendMessage(chatId, 'Поки що використовуйте кнопки в меню.');
      return;
    }

    // -------------------------
    // CALLBACKS
    // -------------------------
    if (update.callback_query) {
      const cq = update.callback_query;
      const callbackId = cq.id;
      const chatId = String(cq.message.chat.id);
      const fromUserId = String(cq.from?.id || '');
      const data = cq.data || '';

      // approvals can work any time
      if (!data.startsWith('hr_') && !data.startsWith('acc_') && shouldBlockByTime(chatId)) {
        const sleepMsg = getBotSleepMessage();
        if (sleepMsg) {
          await answerCallbackQuery(callbackId, sleepMsg);
          await sendMessage(chatId, sleepMsg);
          return;
        }
      }

      await answerCallbackQuery(callbackId);

      const session = getSession(chatId);

      // HRD approve/reject
      if (data.startsWith('hr_approve:') || data.startsWith('hr_reject:')) {
        if (fromUserId !== HRD_USER_ID) {
          await answerCallbackQuery(callbackId, 'Це погодження доступне лише HRD');
          return;
        }

        const requestId = data.split(':')[1];
        const reqResp = await sendToAppsScript({
          action: 'get_timeoff_request',
          request_id: requestId
        });

        if (!reqResp?.ok || !reqResp?.result?.found) {
          await sendMessage(chatId, '⚠️ Заявку не знайдено.');
          return;
        }

        const req = reqResp.result;
        const approverName = [cq.from?.first_name || '', cq.from?.last_name || ''].join(' ').trim() || 'HRD';

        if (data.startsWith('hr_reject:')) {
          await sendToAppsScript({
            action: 'update_timeoff_status',
            request_id: requestId,
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

        await sendToAppsScript({
          action: 'update_timeoff_status',
          request_id: requestId,
          status: 'pending_accountant',
          status_hr: 'approved',
          final_status: 'pending_accountant',
          approved_by_hrd: approverName,
          approved_at_hrd: nowIso()
        });

        if (req.telegram_chat_id) {
          if (req.request_type === 'vacation') {
            await sendMessage(req.telegram_chat_id, 'Напиши заяву у головного бухгалтера');
          } else {
            await sendMessage(req.telegram_chat_id, 'HRD погодила лікарняний. Очікуй фінальне погодження.');
          }
        }

        await sendMessage(chatId, `HRD погодив(ла) заявку ${requestId}. Передаю головному бухгалтеру.`);
        await notifyAccountantForApproval(requestId);
        return;
      }

      // Accountant approve/reject
      if (data.startsWith('acc_approve:') || data.startsWith('acc_reject:')) {
        if (fromUserId !== ACCOUNTANT_USER_ID) {
          await answerCallbackQuery(callbackId, 'Це погодження доступне лише головному бухгалтеру');
          return;
        }

        const requestId = data.split(':')[1];
        const reqResp = await sendToAppsScript({
          action: 'get_timeoff_request',
          request_id: requestId
        });

        if (!reqResp?.ok || !reqResp?.result?.found) {
          await sendMessage(chatId, '⚠️ Заявку не знайдено.');
          return;
        }

        const req = reqResp.result;
        const approverName = [cq.from?.first_name || '', cq.from?.last_name || ''].join(' ').trim() || 'Головний бухгалтер';

        if (data.startsWith('acc_reject:')) {
          await sendToAppsScript({
            action: 'update_timeoff_status',
            request_id: requestId,
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

        await sendToAppsScript({
          action: 'update_timeoff_status',
          request_id: requestId,
          status: 'approved',
          status_chief_acc: 'approved',
          final_status: 'approved',
          approved_by_accountant: approverName,
          approved_at_accountant: nowIso()
        });

        if (req.telegram_chat_id) {
          if (req.request_type === 'vacation') {
            await sendMessage(req.telegram_chat_id, 'Відпустку погоджено остаточно');
          } else {
            await sendMessage(req.telegram_chat_id, 'Лікарняний погоджено остаточно');
          }
        }

        await sendMessage(chatId, `Головний бухгалтер погодив(ла) заявку ${requestId}.`);
        return;
      }

      if (!session) {
        await sendMessage(chatId, '⚠️ Спочатку відкрийте бота через ваш персональний QR.');
        return;
      }

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

      // Main branch
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

        await sendMessage(chatId, 'Виробництво.\nНатисніть Відкрити зміну.', {
          reply_markup: getProductionStartMenu()
        });
        return;
      }

      // Office
      if (data === 'office_start') {
        const dayStatusResp = await sendToAppsScript({
          action: 'get_daily_checkin_status',
          employee_id: session.employee_id
        });

        if (dayStatusResp?.result?.has_any) {
          await sendMessage(chatId, 'Звернись до HRD.');
          return;
        }

        await sendMessage(chatId, 'Оберіть формат роботи:', {
          reply_markup: getOfficeFormatMenu()
        });
        return;
      }

      if (data === 'office_format_office') {
        const dayStatusResp = await sendToAppsScript({
          action: 'get_daily_checkin_status',
          employee_id: session.employee_id
        });

        if (dayStatusResp?.result?.has_any) {
          await sendMessage(chatId, 'Звернись до HRD.');
          return;
        }

        const result = await sendToAppsScript({
          action: 'checkin',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          type: 'in',
          mode: 'office',
          note: 'railway',
          entry_type: 'office',
          work_format: 'office',
          remote_reason: ''
        });

        if (result?.ok) {
          session.checked_in = true;
          session.entry_type = 'office';
          session.work_format = 'office';
          saveSession(chatId, session);

          await sendMessage(chatId, '✅ Вхід зафіксовано.\nФормат роботи: Офіс', {
            reply_markup: getOfficeExitMenu()
          });
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося записати вхід.');
        }
        return;
      }

      if (data === 'office_format_remote') {
        const dayStatusResp = await sendToAppsScript({
          action: 'get_daily_checkin_status',
          employee_id: session.employee_id
        });

        if (dayStatusResp?.result?.has_any) {
          await sendMessage(chatId, 'Звернись до HRD.');
          return;
        }

        session.awaiting_remote_reason = true;
        saveSession(chatId, session);

        await sendMessage(chatId, 'Вкажіть причину віддаленої роботи.\nНаприклад: на дегустаціях / працюю на виїзді');
        return;
      }

      if (data === 'office_checkout') {
        const dayStatusResp = await sendToAppsScript({
          action: 'get_daily_checkin_status',
          employee_id: session.employee_id
        });

        if (!dayStatusResp?.result?.has_in || dayStatusResp?.result?.has_out) {
          await sendMessage(chatId, 'Звернись до HRD.');
          return;
        }

        const result = await sendToAppsScript({
          action: 'checkin',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          type: 'out',
          mode: '',
          note: 'railway',
          entry_type: 'office',
          work_format: session.work_format || '',
          remote_reason: session.remote_reason || ''
        });

        if (result?.ok) {
          session.checked_in = false;
          session.entry_type = '';
          session.work_format = '';
          session.remote_reason = '';
          saveSession(chatId, session);

          await sendMessage(chatId, '🚪 Вихід зафіксовано.');
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося записати вихід.');
        }
        return;
      }

      // Production
      if (data === 'production_open_shift') {
        const dayStatusResp = await sendToAppsScript({
          action: 'get_daily_checkin_status',
          employee_id: session.employee_id
        });

        if (dayStatusResp?.result?.has_any) {
          await sendMessage(chatId, 'Звернись до HRD.');
          return;
        }

        const inResult = await sendToAppsScript({
          action: 'checkin',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          type: 'in',
          mode: 'production',
          note: 'railway',
          entry_type: 'production',
          work_format: 'production',
          remote_reason: ''
        });

        if (!inResult?.ok) {
          await sendMessage(chatId, '⚠️ Не вдалося відкрити зміну.');
          return;
        }

        session.production_shift_open = true;
        session.production_shift_id = makeShiftId(session.employee_id);
        session.production_opened_at = nowIso();
        session.production_entries = [];
        saveSession(chatId, session);

        await sendMessage(chatId, '✅ Зміну відкрито.\nОберіть станцію:', {
          reply_markup: getStationMenu()
        });
        return;
      }

      if (data.startsWith('station_')) {
        if (!session.production_shift_open) {
          await sendMessage(chatId, '⚠️ Спочатку відкрийте зміну.');
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
        const dayStatusResp = await sendToAppsScript({
          action: 'get_daily_checkin_status',
          employee_id: session.employee_id
        });

        if (!dayStatusResp?.result?.has_in || dayStatusResp?.result?.has_out) {
          await sendMessage(chatId, 'Звернись до HRD.');
          return;
        }

        if (!session.production_entries?.length) {
          await sendMessage(chatId, '⚠️ Немає жодного результату по станціях.');
          return;
        }

        const closedAt = nowIso();

        const shiftResult = await sendToAppsScript({
          action: 'production_shift',
          shift_id: session.production_shift_id,
          opened_at: session.production_opened_at,
          closed_at: closedAt,
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          entries: session.production_entries
        });

        if (!shiftResult?.ok) {
          await sendMessage(chatId, '⚠️ Не вдалося записати виробничу зміну.');
          return;
        }

        const outResult = await sendToAppsScript({
          action: 'checkin',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          type: 'out',
          mode: '',
          note: 'railway',
          entry_type: 'production',
          work_format: 'production',
          remote_reason: ''
        });

        if (!outResult?.ok) {
          await sendMessage(chatId, '⚠️ Зміну записано, але не вдалося зафіксувати вихід.');
          return;
        }

        session.production_shift_open = false;
        session.production_shift_id = '';
        session.production_opened_at = '';
        session.production_entries = [];
        session.awaiting_station_result = false;
        session.current_station_name = '';
        saveSession(chatId, session);

        await sendMessage(chatId, '🏁 Зміну закрито.\nДані по станціях збережено.');
        return;
      }

      // Time off
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
