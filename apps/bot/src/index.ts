import { createServer } from 'node:http';
import { webhookCallback } from 'grammy';
import pino from 'pino';
import { createDb } from '@standup/db';
import { createBot } from './bot';
import { loadConfig } from './config';

const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL, redact: ['token'] });

if (!config.BOT_TOKEN) {
  // Не падаем, чтобы `docker compose up` поднимал остальную систему без токена.
  log.warn('BOT_TOKEN не задан — бот не запущен');
  setInterval(() => {}, 1 << 30);
} else {
  const { db, close } = createDb(config.DATABASE_URL);
  const { bot, setup } = createBot(config, db, log);
  await setup();

  if (config.BOT_MODE === 'webhook') {
    if (!config.BOT_WEBHOOK_SECRET)
      throw new Error('BOT_WEBHOOK_SECRET обязателен в режиме webhook');
    const handle = webhookCallback(bot, 'http', { secretToken: config.BOT_WEBHOOK_SECRET });
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/bot/webhook') return void handle(req, res);
      res.writeHead(404).end();
    });
    server.listen(config.BOT_WEBHOOK_PORT, () =>
      log.info({ port: config.BOT_WEBHOOK_PORT }, 'bot webhook server started'),
    );
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ onStart: (me) => log.info({ username: me.username }, 'bot polling started') });
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      await bot.stop();
      await close();
      process.exit(0);
    });
  }
}
