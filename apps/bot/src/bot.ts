import { Bot, InlineKeyboard } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import type { Logger } from 'pino';
import { findUserByTelegramId, upsertTelegramChat, upsertTelegramUser, type Db } from '@standup/db';
import { renderDigest, todayFor, type InlineButton } from '@standup/notify';
import { ru } from '@standup/shared';
import { apiRequestFor, parseCallback } from './callbacks';
import type { BotConfig } from './config';
import { isValidStartParam, miniAppDirectLink } from './links';
import { botCanPost, joined, type ChatMemberStatus } from './membership';

function toMarkup(rows: InlineButton[][] = []): InlineKeyboardMarkup {
  return {
    inline_keyboard: rows.map((row) =>
      row.map((b) =>
        b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.callbackData! },
      ),
    ),
  };
}

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

  /** Действие пользователя через API (те же проверки прав, что и в Mini App). */
  async function asUser(telegramId: number, req: ReturnType<typeof apiRequestFor>) {
    const res = await fetch(`${config.API_INTERNAL_URL}/api/v1/internal/as-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': config.INTERNAL_TOKEN },
      body: JSON.stringify({ telegramId, ...req }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      called?: number;
      error?: { code: string; message: string };
    };
    return { ok: res.ok, body };
  }

  bot.on('callback_query:data', async (ctx) => {
    const cb = parseCallback(ctx.callbackQuery.data);
    if (!cb) return ctx.answerCallbackQuery();
    const { ok, body } = await asUser(ctx.from.id, apiRequestFor(cb)).catch((err) => {
      log.error({ err }, 'internal API call failed');
      return {
        ok: false,
        body: {} as { error?: { code: string; message: string }; called?: number },
      };
    });
    if (!ok) {
      const text = body.error?.code === 'CONFLICT_SCHEDULE' ? t.conflict : ru.notify.callbackError;
      return ctx.answerCallbackQuery({ text, show_alert: true });
    }
    const text =
      cb.kind === 'reserve'
        ? ru.notify.reserveCalled(body.called ?? 0)
        : cb.kind === 'day'
          ? cb.value === 'confirmed'
            ? ru.notify.confirmedReply
            : ru.notify.declinedReply
          : ru.notify.callbackDone;
    await ctx.answerCallbackQuery({ text });
    // Убираем из сообщения кнопки, на которые уже ответили.
    const markup = ctx.callbackQuery.message?.reply_markup;
    if (markup && cb.kind !== 'reserve') {
      const rows = markup.inline_keyboard
        .map((row) =>
          row.filter(
            (b) => !('callback_data' in b) || !b.callback_data?.includes(cb.participationId),
          ),
        )
        .filter((row) => row.length > 0);
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: rows } }).catch(() => {});
    }
  });

  bot.command('today', async (ctx) => {
    if (!ctx.from || ctx.chat.type !== 'private') return;
    const user = await findUserByTelegramId(db, ctx.from.id);
    if (!user) return ctx.reply(t.notRegistered);
    const digest = await renderDigest(db, user, todayFor(user.timezone, new Date()), {
      repeat: false,
    });
    if ('skip' in digest) return ctx.reply(ru.notify.noGigsToday);
    await ctx.reply(digest.message.text, { reply_markup: toMarkup(digest.message.buttons) });
  });

  bot.command('settings', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const kb = new InlineKeyboard();
    if (webAppUrl) kb.webApp(t.openSettings, `${webAppUrl.replace(/\/$/, '')}/settings`);
    else {
      const link = miniAppDirectLink(config.BOT_USERNAME, config.MINIAPP_SHORT_NAME);
      if (link) kb.url(t.openSettings, link);
    }
    await ctx.reply(ru.notify.settings, { reply_markup: kb });
  });

  // Бота добавили в группу/канал, изменили права или удалили: запоминаем, куда можно постить
  // анонсы. «Кто добавил» — тот, кто совершил добавление; публиковать сможет только он.
  bot.on('my_chat_member', async (ctx) => {
    const { chat, from, new_chat_member, old_chat_member } = ctx.myChatMember;
    if (chat.type === 'private') return;
    const isJoin = joined(old_chat_member.status, new_chat_member.status);
    const adder = isJoin ? await upsertTelegramUser(db, from) : null;
    await upsertTelegramChat(db, {
      telegramChatId: chat.id,
      title: chat.title,
      type: chat.type,
      addedBy: adder?.id ?? null,
      botCanPost: botCanPost(chat.type, new_chat_member as ChatMemberStatus),
    });
    log.info({ chatId: chat.id, status: new_chat_member.status }, 'bot chat membership changed');
  });

  bot.catch((err) => {
    log.error({ err: err.error, updateId: err.ctx.update.update_id }, 'bot handler error');
  });

  async function setup() {
    await bot.api.setMyCommands([
      { command: 'start', description: t.commands.start },
      { command: 'today', description: t.commands.today },
      { command: 'settings', description: t.commands.settings },
    ]);
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
