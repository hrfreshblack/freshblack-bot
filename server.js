import express from 'express';
import axios from 'axios';

const app = express();
const PORT = 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby-ugcBT56kECb0mJxyK4AhncNQfuyW9XISvVEja9t9s_hJENISv6HMvFop9_ZAbfBqpw/exec';

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
      timeout: 15000
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
    text
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

    if (update.message) {
      const msg = update.message;
      const chatId = String(msg.chat.id);
      const text = (msg.text || '').trim();

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

        const fullName = empResp.result.full_name || '';

        saveSession(chatId, {
          employee_id: employeeId,
          full_name: fullName,
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

        await sendMessage(chatId, `👋 Вітаю, <b>${fullName}</b>.\nОберіть напрям роботи:`, {
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
        session.awaiting_remote_reason = false;
        session.remote_reason = text;
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
          remote_reason: text
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

      // Результат по виробничій станції
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
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося створити заявку на лікарняний.');
        }
        return;
      }

      await sendMessage(chatId, 'Поки що використовуйте кнопки в меню.');
      return;
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const callbackId = cq.id;
      const chatId = String(cq.message.chat.id);
      const data = cq.data || '';

      await answerCallbackQuery(callbackId);

      const session = getSession(chatId);

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

      // Головна розвилка
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

      // Офіс
      if (data === 'office_start') {
        if (session.checked_in) {
          await sendMessage(chatId, 'ℹ️ Вхід уже зафіксовано.');
          return;
        }

        await sendMessage(chatId, 'Оберіть формат роботи:', {
          reply_markup: getOfficeFormatMenu()
        });
        return;
      }

      if (data === 'office_format_office') {
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

        if (result && result.ok) {
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
        session.awaiting_remote_reason = true;
        saveSession(chatId, session);

        await sendMessage(chatId, 'Вкажіть причину віддаленої роботи.\nНаприклад: на дегустаціях / працюю на виїзді');
        return;
      }

      if (data === 'office_checkout') {
        if (!session.checked_in) {
          await sendMessage(chatId, 'ℹ️ Спочатку треба зафіксувати Вхід.');
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

        if (result && result.ok) {
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

      // Виробництво
      if (data === 'production_open_shift') {
        if (session.production_shift_open) {
          await sendMessage(chatId, 'ℹ️ Зміна вже відкрита.\nОберіть станцію:', {
            reply_markup: getStationMenu()
          });
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
        if (!session.production_entries || !session.production_entries.length) {
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
          await sendMessage(chatId, 'ℹ️ Зміна вже закрита.');
          return;
        }

        if (!session.production_entries || !session.production_entries.length) {
          await sendMessage(chatId, '⚠️ Немає жодного результату по станціях.');
          return;
        }

        const closedAt = nowIso();

        const result = await sendToAppsScript({
          action: 'production_shift',
          shift_id: session.production_shift_id,
          opened_at: session.production_opened_at,
          closed_at: closedAt,
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          entries: session.production_entries
        });

        if (result && result.ok) {
          session.production_shift_open = false;
          session.production_shift_id = '';
          session.production_opened_at = '';
          session.production_entries = [];
          session.awaiting_station_result = false;
          session.current_station_name = '';
          saveSession(chatId, session);

          await sendMessage(chatId, '🏁 Зміну закрито.\nДані по станціях збережено.');
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося записати виробничу зміну.');
        }
        return;
      }

      // Запити
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
