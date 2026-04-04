import express from 'express';
import axios from 'axios';

const app = express();
const PORT = 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

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

    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const text = (msg.text || '').trim();

      console.log('Incoming text:', text);

      if (/^\/ping$/i.test(text)) {
        await sendMessage(chatId, 'pong ✅');
        return;
      }

      if (/^\/start/i.test(text)) {
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

      console.log('Callback data:', data);

      await answerCallbackQuery(callbackId);

      if (data === 'checkin') {
        await sendMessage(chatId, 'Оберіть формат роботи:', {
          reply_markup: getModeMenu()
        });
        return;
      }

      if (data === 'checkout') {
        await sendMessage(chatId, '🚪 Вихід натиснуто.\nДалі підключимо фіксацію в таблицю.');
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

      if (data === 'mode_office') {
        await sendMessage(chatId, '✅ Обрано формат роботи: Офіс');
        return;
      }

      if (data === 'mode_remote') {
        await sendMessage(chatId, '✅ Обрано формат роботи: Віддалено');
        return;
      }

      if (data === 'vacation') {
        await sendMessage(
          chatId,
          '🏖 Відпустка\n\nНадалі тут підключимо подачу заявки одним повідомленням.'
        );
        return;
      }

      if (data === 'sick') {
        await sendMessage(
          chatId,
          '🤒 Лікарняний\n\nНадалі тут підключимо подачу заявки одним повідомленням.'
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
