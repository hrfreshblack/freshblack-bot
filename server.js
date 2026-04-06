const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';

const TELEGRAM_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyz6u4aEJv0FOY5Jbk85wc4OC88Tq8sdDXiSG_JhqW3VAYLggQHWB7F7ur179NPha3kuQ/exec';

app.use(express.json({ limit: '2mb' }));
app.use(express.text({ type: '*/*', limit: '2mb' }));

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
    const update = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    if (update.message && update.message.text === '/ping') {
      const chatId = String(update.message.chat.id);

      if (BOT_TOKEN) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: 'pong ✅'
        });
      }
    }
  } catch (e) {
    console.error('WEBHOOK ERROR:', e && e.stack ? e.stack : e);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
