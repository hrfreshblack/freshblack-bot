import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN is required');
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendMessage(chatId, text) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text
  });
}

app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.get('/health', (req, res) => {
  res.send('OK');
});

app.post('/webhook', async (req, res) => {
  res.status(200).send('OK');

  const update = req.body || {};

  try {
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = (update.message.text || '').trim();

      if (/^\/ping$/i.test(text)) {
        await sendMessage(chatId, 'pong ✅');
        return;
      }

      if (/^\/start/i.test(text)) {
        await sendMessage(chatId, '👋 FreshBlack bot на Railway уже живий.');
        return;
      }

      await sendMessage(chatId, `Отримала повідомлення: ${text || '(без тексту)'}`);
    }
  } catch (error) {
    console.error('Webhook error:', error?.response?.data || error?.message || error);
  }
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
