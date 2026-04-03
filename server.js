import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json({ limit: '2mb' }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

console.log('BOT_TOKEN exists:', !!BOT_TOKEN);
console.log('BOT_TOKEN preview:', BOT_TOKEN ? BOT_TOKEN.slice(0, 12) + '...' : 'MISSING');

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

    console.log('sendMessage OK:', JSON.stringify(resp.data));
  } catch (error) {
    console.error(
      'sendMessage ERROR:',
      JSON.stringify(error?.response?.data || error?.message || error)
    );
  }
}

app.get('/', (_req, res) => {
  res.status(200).send('Bot is running');
});

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body || {};
    console.log('Webhook update received');

    res.status(200).send('OK');

    if (update.message) {
      const chatId = update.message.chat.id;
      const text = (update.message.text || '').trim();

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
    console.error('WEBHOOK ERROR:', error?.stack || error?.message || error);
    try {
      if (!res.headersSent) {
        res.status(200).send('OK');
      }
    } catch (_) {}
  }
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
