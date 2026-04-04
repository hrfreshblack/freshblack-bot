import express from 'express';
import axios from 'axios';

const app = express();
const PORT = 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

app.use(express.text({ type: '*/*' }));

async function sendMessage(chatId, text) {
  try {
    const resp = await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text
    });
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
  res.sendStatus(200);

  try {
    console.log('WEBHOOK HIT');

    const rawBody = req.body || '{}';
    const update = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

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
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
