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
// In-memory employee binding
// Тимчасово: employee_id беремо з payload у /start
// =========================
const employeeSessions = new Map();
// chatId -> { employee_id, full_name, telegram_chat_id }

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
    console.log('WEBHOOK HIT');

    const rawBody = req.body || '{}';
    const update = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

    // =====================
    // TEXT MESSAGES
    // =====================
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
        // Тягнемо employee_id із QR payload
        // Формат очікуємо: /start FB000152
        const m = text.match(/^\/start\s+([A-Za-z0-9\-_]+)/i);
        const employeeId = m ? String(m[1]).trim() : '';

        if (employeeId) {
          employeeSessions.set(String(chatId), {
            employee_id: employeeId,
            full_name: fullName,
            telegram_chat_id: String(chatId)
          });
        }

        await sendMessage(chatId, '👋 Вітаю! Оберіть дію:', {
          reply_markup: getMainMenu()
        });
        return;
      }

      await sendMessage(chatId, 'Поки що використовуйте /start для відкриття меню.');
      return;
    }

    // =====================
    // CALLBACK BUTTONS
    // =====================
    if (update.callback_query) {
      const cq = update.callback_query;
      const callbackId = cq.id;
      const chatId = cq.message.chat.id;
      const data = cq.data || '';

      console.log('Callback data:', data);

      await answerCallbackQuery(callbackId);

      const session = employeeSessions.get(String(chatId));

      if (data === 'checkin') {
        if (!session || !session.employee_id) {
          await sendMessage(chatId, '⚠️ Спочатку відкрийте бота через ваш персональний QR.');
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
