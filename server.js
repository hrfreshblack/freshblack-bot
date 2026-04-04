import express from 'express';
import axios from 'axios';

const app = express();
const PORT = 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyKGRJboSTrZBhLVh52e6kSvYl9XoUMz-AQme81bmrQITiqhzmQ5Rpl5US9-t1rZRzGeg/exec';

app.use(express.text({ type: '*/*' }));

// =========================
// Telegram helpers
// =========================
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

// =========================
// Apps Script bridge
// =========================
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

// =========================
// In-memory sessions
// =========================
// chatId -> {
//   employee_id,
//   full_name,
//   telegram_chat_id,
//   checked_in,
//   mode
// }
const employeeSessions = new Map();

// =========================
// Menus
// =========================
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

// =========================
// Helpers
// =========================
function getSession(chatId) {
  return employeeSessions.get(String(chatId));
}

function saveSession(chatId, session) {
  employeeSessions.set(String(chatId), session);
}

// =========================
// Routes
// =========================
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
          mode: prev.mode || ''
        });

        await sendMessage(chatId, '👋 Вітаю! Оберіть дію:', {
          reply_markup: getMainMenu()
        });
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
        await sendMessage(chatId, '👋 Вітаю! Оберіть дію:', {
          reply_markup: getMainMenu()
        });
        return;
      }

      if (data === 'vacation') {
        await sendMessage(chatId, '🏖 Відпустка\n\nНаступним кроком підключимо подачу заявки.');
        return;
      }

      if (data === 'sick') {
        await sendMessage(chatId, '🤒 Лікарняний\n\nНаступним кроком підключимо подачу заявки.');
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
