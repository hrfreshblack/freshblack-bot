import express from 'express';
import axios from 'axios';

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';

const TELEGRAM_API = BOT_TOKEN ? `https://api.telegram.org/bot${BOT_TOKEN}` : '';

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
    let update = req.body || {};
    if (typeof update === 'string') {
      update = update.trim() ? JSON.parse(update) : {};
    }

    if (update.message?.text === '/ping') {
      const chatId = String(update.message.chat.id);

      if (BOT_TOKEN) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: 'pong ✅'
        });
      }
    }
  } catch (e) {
    console.error('WEBHOOK ERROR:', e?.stack || e?.message || e);
  }
});

const PORT = process.env.PORT;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
