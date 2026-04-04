import express from 'express';
import axios from 'axios';

const app = express();
const PORT = 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyKGRJboSTrZBhLVh52e6kSvYl9XoUMz-AQme81bmrQITiqhzmQ5Rpl5US9-t1rZRzGeg/exec';

app.use(express.text({ type: '*/*' }));

async function telegram(method, payload) {
  try {
    const resp = await axios.post(`${TELEGRAM_API}/${method}`, payload, {
      timeout: 15000
    });
    console.log(`${method} OK:`, JSON.stringify(resp.data));
    return resp.data;
  } catch (error) {
    console.error(
      `${method} ERROR:`,
      JSON.stringify(error?.response?.data || error?.message || error)
    );
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

    console.log('Apps Script OK:', JSON.stringify(resp.data));
    return resp.data;
  } catch (error) {
    console.error(
      'Apps Script ERROR:',
      JSON.stringify(error?.response?.data || error?.message || error)
    );
    return null;
  }
}

const employeeSessions = new Map();
// chatId -> {
//   employee_id,
//   full_name,
//   telegram_chat_id,
//   checked_in,
//   mode,
//   flow: null | 'vacation' | 'sick'
// }

function getMainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Вхід', callback_data: 'checkin' },
        { text: '🚪 Вихід', callback_data: 'checkout' }
      ],
      [
        { text: '📅 Подати запит', callback_data: 'timeoff_menu' }
      ]
    ]
  };
}

function getModeMenu() {
  return {
    inline_keyboard: [
      [
        { text: '🏢 Офіс', callback_data: 'mode_office' },
        { text: '🏠 Віддалено', callback_data: 'mode_remote' }
      ]
    ]
  };
}

function getTimeoffMenu() {
  return {
    inline_keyboard: [
      [
        { text: '🏖 Відпустка', callback_data: 'vacation' },
        { text: '🤒 Лікарняний', callback_data: 'sick' }
      ],
      [
        { text: '⬅️ Назад', callback_data: 'back_main' }
      ]
    ]
  };
}

function getSession(chatId) {
  return employeeSessions.get(String(chatId));
}

function saveSession(chatId, session) {
  employeeSessions.set(String(chatId), session);
}

function parseDate(dateStr) {
  const m = String(dateStr).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;

  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);

  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) return null;

  return dt;
}

function parseDateRangePart(rangePart) {
  const m = String(rangePart).match(/^\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})\s*$/);
  if (!m) return null;

  const d1 = parseDate(m[1]);
  const d2 = parseDate(m[2]);
  if (!d1 || !d2) return null;
  if (d2 < d1) return null;

  return {
    date_from: m[1],
    date_to: m[2]
  };
}

function parseVacationInput(text) {
  const parts = text.split(';');
  if (parts.length < 2) return null;

  const range = parseDateRangePart(parts[0]);
  if (!range) return null;

  const replacement = String(parts.slice(1).join(';')).trim();
  if (!replacement) return null;

  return {
    ...range,
    replacement_person: replacement
  };
}

function parseSickInput(text) {
  const parts = text.split(';');
  if (parts.length < 2) return null;

  const range = parseDateRangePart(parts[0]);
  if (!range) return null;

  const comment = String(parts.slice(1).join(';')).trim();

  return {
    ...range,
    comment: comment === '-' ? '' : comment
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
      const chatId = msg.chat.id;
      const text = (msg.text || '').trim();
      const from = msg.from || {};
      const fullName = [from.first_name || '', from.last_name || ''].join(' ').trim();

      console.log('Incoming text:', text);

      if (/^\/ping$/i.test(text)) {
        await sendMessage(chatId, 'pong ✅');
        return;
      }

      if (/^\/start/i.test(text)) {
        const m = text.match(/^\/start\s+([A-Za-z0-9\-_]+)/i);
        const employeeId = m ? String(m[1]).trim() : '';

        const prev = getSession(chatId) || {};

        saveSession(chatId, {
          employee_id: employeeId || prev.employee_id || '',
          full_name: fullName || prev.full_name || '',
          telegram_chat_id: String(chatId),
          checked_in: prev.checked_in || false,
          mode: prev.mode || '',
          flow: null
        });

        await sendMessage(chatId, '👋 Вітаю! Оберіть дію:', {
          reply_markup: getMainMenu()
        });
        return;
      }

      let session = getSession(chatId);

      if (!session) {
        await sendMessage(chatId, '⚠️ Спочатку відкрийте бота через ваш персональний QR.');
        return;
      }

      if (session.flow === 'vacation') {
        const parsed = parseVacationInput(text);

        if (!parsed) {
          await sendMessage(
            chatId,
            '⚠️ Невірний формат.\nНадішліть так:\n<code>10.04.2026 - 15.04.2026; Іван Петренко</code>'
          );
          return;
        }

        const result = await sendToAppsScript({
          action: 'timeoff_request',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          request_type: 'vacation',
          date_from: parsed.date_from,
          date_to: parsed.date_to,
          replacement_person: parsed.replacement_person,
          replacement_contact: '',
          comment: ''
        });

        session.flow = null;
        saveSession(chatId, session);

        if (result && result.ok) {
          await sendMessage(
            chatId,
            `✅ Заявку на відпустку створено.\nПеріод: ${parsed.date_from} - ${parsed.date_to}\nЗаміщає: ${parsed.replacement_person}\n\nСтатус: очікує погодження`
          );
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося записати заявку на відпустку.');
        }
        return;
      }

      if (session.flow === 'sick') {
        const parsed = parseSickInput(text);

        if (!parsed) {
          await sendMessage(
            chatId,
            '⚠️ Невірний формат.\nНадішліть так:\n<code>10.04.2026 - 12.04.2026; температура</code>'
          );
          return;
        }

        const result = await sendToAppsScript({
          action: 'timeoff_request',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          request_type: 'sick',
          date_from: parsed.date_from,
          date_to: parsed.date_to,
          replacement_person: '',
          replacement_contact: '',
          comment: parsed.comment || ''
        });

        session.flow = null;
        saveSession(chatId, session);

        if (result && result.ok) {
          await sendMessage(
            chatId,
            `✅ Заявку на лікарняний створено.\nПеріод: ${parsed.date_from} - ${parsed.date_to}\n\nСтатус: очікує погодження`
          );
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося записати заявку на лікарняний.');
        }
        return;
      }

      await sendMessage(chatId, 'Поки що використовуйте /start для відкриття меню.');
      return;
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const callbackId = cq.id;
      const chatId = cq.message.chat.id;
      const data = cq.data || '';

      await answerCallbackQuery(callbackId);

      let session = getSession(chatId);

      if (data === 'checkin') {
        if (!session || !session.employee_id) {
          await sendMessage(chatId, '⚠️ Спочатку відкрийте бота через ваш персональний QR.');
          return;
        }

        if (session.checked_in) {
          await sendMessage(
            chatId,
            `ℹ️ Початок робочого дня вже зафіксовано${session.mode ? ` (${session.mode === 'office' ? 'Офіс' : 'Віддалено'})` : ''}.`
          );
          return;
        }

        await sendMessage(chatId, 'Оберіть формат роботи:', {
          reply_markup: getModeMenu()
        });
        return;
      }

      if (data === 'mode_office') {
        if (!session || !session.employee_id) {
          await sendMessage(chatId, '⚠️ Не знайдено employee_id. Відскануйте QR ще раз.');
          return;
        }

        if (session.checked_in) {
          await sendMessage(chatId, 'ℹ️ Вхід уже зафіксовано. Повторно натискати не потрібно.');
          return;
        }

        const result = await sendToAppsScript({
          action: 'checkin',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          type: 'in',
          mode: 'office',
          note: 'railway'
        });

        if (result && result.ok) {
          session.checked_in = true;
          session.mode = 'office';
          saveSession(chatId, session);

          await sendMessage(chatId, '✅ Обрано формат роботи: Офіс\nПочаток робочого дня зафіксовано.');
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося записати вхід у таблицю.');
        }
        return;
      }

      if (data === 'mode_remote') {
        if (!session || !session.employee_id) {
          await sendMessage(chatId, '⚠️ Не знайдено employee_id. Відскануйте QR ще раз.');
          return;
        }

        if (session.checked_in) {
          await sendMessage(chatId, 'ℹ️ Вхід уже зафіксовано. Повторно натискати не потрібно.');
          return;
        }

        const result = await sendToAppsScript({
          action: 'checkin',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          type: 'in',
          mode: 'remote',
          note: 'railway'
        });

        if (result && result.ok) {
          session.checked_in = true;
          session.mode = 'remote';
          saveSession(chatId, session);

          await sendMessage(chatId, '✅ Обрано формат роботи: Віддалено\nПочаток робочого дня зафіксовано.');
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося записати вхід у таблицю.');
        }
        return;
      }

      if (data === 'checkout') {
        if (!session || !session.employee_id) {
          await sendMessage(chatId, '⚠️ Не знайдено employee_id. Відскануйте QR ще раз.');
          return;
        }

        if (!session.checked_in) {
          await sendMessage(chatId, 'ℹ️ Спочатку потрібно зафіксувати Вхід.');
          return;
        }

        const result = await sendToAppsScript({
          action: 'checkin',
          employee_id: session.employee_id,
          telegram_chat_id: session.telegram_chat_id,
          full_name: session.full_name,
          type: 'out',
          mode: '',
          note: 'railway'
        });

        if (result && result.ok) {
          session.checked_in = false;
          session.mode = '';
          saveSession(chatId, session);

          await sendMessage(chatId, '🚪 Вихід зафіксовано.');
        } else {
          await sendMessage(chatId, '⚠️ Не вдалося записати вихід у таблицю.');
        }
        return;
      }

      if (data === 'timeoff_menu') {
        await sendMessage(chatId, 'Оберіть тип запиту:', {
          reply_markup: getTimeoffMenu()
        });
        return;
      }

      if (data === 'back_main') {
        if (session) {
          session.flow = null;
          saveSession(chatId, session);
        }

        await sendMessage(chatId, '👋 Вітаю! Оберіть дію:', {
          reply_markup: getMainMenu()
        });
        return;
      }

      if (data === 'vacation') {
        if (!session || !session.employee_id) {
          await sendMessage(chatId, '⚠️ Спочатку відкрийте бота через ваш персональний QR.');
          return;
        }

        session.flow = 'vacation';
        saveSession(chatId, session);

        await sendMessage(
          chatId,
          '🏖 Відпустка\n\nНадішліть одним повідомленням у форматі:\n<code>10.04.2026 - 15.04.2026; Іван Петренко</code>'
        );
        return;
      }

      if (data === 'sick') {
        if (!session || !session.employee_id) {
          await sendMessage(chatId, '⚠️ Спочатку відкрийте бота через ваш персональний QR.');
          return;
        }

        session.flow = 'sick';
        saveSession(chatId, session);

        await sendMessage(
          chatId,
          '🤒 Лікарняний\n\nНадішліть одним повідомленням у форматі:\n<code>10.04.2026 - 12.04.2026; температура</code>'
        );
        return;
      }

      await sendMessage(chatId, `Невідома дія: ${data}`);
    }
  } catch (error) {
    console.error('WEBHOOK ERROR:', error?.stack || error?.message || error);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
