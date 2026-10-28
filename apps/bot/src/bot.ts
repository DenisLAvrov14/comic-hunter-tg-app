import { Bot, InlineKeyboard } from 'grammy';
import type { Logger } from 'pino';
import { upsertTelegramUser, type Db } from '@standup/db';
import { ru } from '@standup/shared';
import type { BotConfig } from './config';
import { isValidStartParam, miniAppDirectLink } from './links';

export function createBot(config: BotConfig, db: Db, log: Logger) {
  const bot = new Bot(config.BOT_TOKEN);
  const t = ru.bot;
  const webAppUrl = config.MINIAPP_URL.startsWith('https://') ? config.MINIAPP_URL : null;

  bot.command('start', async (ctx) => {
    if (!ctx.from || ctx.chat.type !== 'private') return;
    await upsertTelegramUser(db, ctx.from, { botStarted: true });

    const payload = ctx.match.trim();
    const keyboard = new InlineKeyboard();
    // Параметр /start (переход на событие и т.п.) открываем через прямую ссылку,
    // т.к. web_app-кнопка не передаёт start_param.
    const deepLink = isValidStartParam(payload)
      ? miniAppDirectLink(config.BOT_USERNAME, config.MINIAPP_SHORT_NAME, payload)
      : null;
    if (deepLink) keyboard.url(t.start.openEvent, deepLink).row();
    if (webAppUrl) keyboard.webApp(t.start.openApp, webAppUrl);

    const text = webAppUrl
      ? t.start.greeting(ctx.from.first_name)
      : `${t.start.greeting(ctx.from.first_name)}\n\n${t.start.miniAppNotConfigured}`;
    await ctx.reply(text, { reply_markup: keyboard });
  });

  bot.catch((err) => {
    log.error({ err: err.error, updateId: err.ctx.update.update_id }, 'bot handler error');
  });

  async function setup() {
    await bot.api.setMyCommands([{ command: 'start', description: t.start.openApp }]);
    if (webAppUrl) {
      await bot.api.setChatMenuButton({
        menu_button: { type: 'web_app', text: t.menuButton, web_app: { url: webAppUrl } },
      });
    } else {
      log.warn('MINIAPP_URL не задан или не https — кнопка меню Mini App не установлена');
    }
  }

  return { bot, setup };
}
