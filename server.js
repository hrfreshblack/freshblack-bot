import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json({ limit: '2mb' }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is missing');
}

const TELEGRAM_API = BOT_TOKEN
  ? `https://api.telegram.org/bot${BOT_TOKEN}`
  : null;

async function sendMessage(chatId, text) {
  if (!TELEGRAM_API) {
    console.error('sendMessage skipped: BOT_TOKEN missing');
    return;
  }

  try {
    const resp = await axios.post(
      `${TELEGRAM_API}/sendMessage`,
      {
        chat_id: chatId,
        text
      },
      {
        timeout: 10000
      }
    );

    console.log('sendMessage OK:', resp.data);
  } catch (error) {
    console.error(
      'sendMessage ERROR:',
      error?.response?.data || error?.message || error
    );
  }
}

app.get('/', (_req, res) => {
  res.status(200).send('Bot is running');
});

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.post('/webhook', (req, res) => {
  // ВАЖЛИВО: віддаємо 200 одразу
  res.status(200).send('OK');

  // Далі обробляємо вже окремо, щоб не валити webhook
  setImmediate(async () => {
    try {
      const update = req.body || {};
      console.log('Webhook update:', JSON.stringify(update));

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
          await sendMessage(chatId, '👋 FreshBlack bot на Railway уже живий.');
          return;
        }

        await sendMessage(chatId, `Отримала повідомлення: ${text || '(без тексту)'}`);
        return;
      }

      if (update.callback_query) {
        console.log('Callback received');
      }
    } catch (error) {
      console.error('WEBHOOK PROCESS ERROR:', error?.stack || error?.message || error);
    }
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
