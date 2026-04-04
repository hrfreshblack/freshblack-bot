import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.status(200).send('Bot is running');
});

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

// БЕЗ body parser, БЕЗ axios, БЕЗ req.body
app.post('/webhook', (_req, res) => {
  console.log('WEBHOOK HIT');
  return res.sendStatus(200);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server started on port ${PORT}`);
});
