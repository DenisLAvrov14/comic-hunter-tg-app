import { createServer } from 'node:http';
import { webhookCallback } from 'grammy';
import pino from 'pino';
import { createDb } from '@standup/db';
import { createBot } from './bot';
import { loadConfig } from './config';

// my_chat_member — бота добавили в группу или канал (анонсы, SPEC §7.4);
// chat_join_request — заявки на вступление в чат события.
const ALLOWED_UPDATES = [
  'message',
  'callback_query',
  'my_chat_member',
  'chat_join_request',
] as const;

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
    const handle = webhookCallback(bot, 'http', { secretToken: config.BOT_WEBHOOK_SECRET });
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/bot/webhook') return void handle(req, res);
      res.writeHead(404).end();
    });
    server.listen(config.BOT_WEBHOOK_PORT, () =>
      log.info({ port: config.BOT_WEBHOOK_PORT }, 'bot webhook server started'),
    );
    // Регистрируем адрес при каждом старте: смена домена или секрета подхватится сама.
    await bot.api.setWebhook(config.BOT_WEBHOOK_URL, {
      secret_token: config.BOT_WEBHOOK_SECRET,
      allowed_updates: ALLOWED_UPDATES,
    });
    log.info('bot webhook registered');
  } else {
    await bot.api.deleteWebhook();
    void bot.start({
      allowed_updates: ALLOWED_UPDATES,
      onStart: (me) => log.info({ username: me.username }, 'bot polling started'),
    });
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      // Вебхук не снимаем: Telegram подождёт с доставкой, пока бот перезапускается.
      if (bot.isRunning()) await bot.stop();
      await close();
      process.exit(0);
    });
  }
}
