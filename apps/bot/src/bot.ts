import { Bot, InlineKeyboard } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import type { Logger } from 'pino';
import {
  countParticipationsByEvent,
  countPhotos,
  findCity,
  findComedianProfile,
  findOrganizerProfile,
  findUserByTelegramId,
  getUserRoles,
  listBusySlotsInRange,
  listCalendarGigs,
  listOpenEvents,
  listOrganizerEvents,
  upsertTelegramChat,
  upsertTelegramUser,
  type Db,
} from '@standup/db';
import { renderDigest, todayFor, type InlineButton } from '@standup/notify';
import { ru } from '@standup/shared';
import { apiRequestFor, callbackTarget, parseCallback } from './callbacks';
import {
  renderProfile,
  renderSchedule,
  renderSlots,
  SCHEDULE_DAYS,
  SLOTS_DAYS,
  type SlotEvent,
} from './commands';
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
          : cb.kind === 'host'
            ? ru.notify.hostReply[cb.value]
            : ru.notify.callbackDone;
    await ctx.answerCallbackQuery({ text });
    // Убираем из сообщения кнопки, на которые уже ответили.
    const markup = ctx.callbackQuery.message?.reply_markup;
    if (markup && cb.kind !== 'reserve') {
      const rows = markup.inline_keyboard
        .map((row) =>
          row.filter(
            (b) => !('callback_data' in b) || !b.callback_data?.includes(callbackTarget(cb)),
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

  /** Кнопка на экран Mini App: web_app с путём в личке или прямая ссылка, если URL не https. */
  function openButton(text: string, path: string): InlineKeyboard {
    const kb = new InlineKeyboard();
    if (webAppUrl) kb.webApp(text, `${webAppUrl.replace(/\/$/, '')}${path}`);
    else {
      const link = miniAppDirectLink(config.BOT_USERNAME, config.MINIAPP_SHORT_NAME);
      if (link) kb.url(text, link);
    }
    return kb;
  }

  bot.command('settings', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    await ctx.reply(ru.notify.settings, { reply_markup: openButton(t.openSettings, '/settings') });
  });

  const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

  /** Расписание: свои выступления (принятые и добавленные вручную) и события организатора. */
  bot.command('schedule', async (ctx) => {
    if (!ctx.from || ctx.chat.type !== 'private') return;
    const user = await findUserByTelegramId(db, ctx.from.id);
    if (!user) return ctx.reply(t.notRegistered);
    const roles = await getUserRoles(db, user.id);
    const now = new Date();
    const until = daysAhead(SCHEDULE_DAYS);
    const isComedian = roles.includes('comedian');
    const [gigs, busy, own] = await Promise.all([
      isComedian ? listCalendarGigs(db, user.id, now, until) : [],
      isComedian ? listBusySlotsInRange(db, user.id, now, until) : [],
      roles.includes('organizer') ? listOrganizerEvents(db, user.id, 'upcoming', now) : null,
    ]);
    const ownSoon = own?.filter((r) => r.event.startsAt < until && r.event.status !== 'cancelled');
    const awaiting = await countParticipationsByEvent(db, ownSoon?.map((r) => r.event.id) ?? [], [
      'pending',
      'counter_proposed',
    ]);
    const text = renderSchedule({
      gigs: [
        ...gigs.map((g) => ({
          title: g.event.title,
          venue: g.venue.name,
          startsAt: g.event.startsAt,
          timezone: g.venue.timezone,
          position: g.participation.position,
        })),
        ...busy
          .filter((b) => b.kind === 'manual_gig')
          .map((b) => ({
            manual: true as const,
            title: b.title,
            venue: b.venueText,
            startsAt: b.startsAt,
            timezone: user.timezone,
          })),
      ],
      events:
        ownSoon?.map((r) => ({
          title: r.event.title,
          venue: r.venue.name,
          startsAt: r.event.startsAt,
          timezone: r.venue.timezone,
          accepted: r.acceptedCount,
          slots: r.event.slotsCount,
          awaiting: awaiting.get(r.event.id) ?? 0,
        })) ?? null,
    });
    await ctx.reply(text, {
      reply_markup: openButton(t.schedule.openCalendar, isComedian ? '/calendar' : '/my-events'),
    });
  });

  /** Свободные места: открытые наборы в городе комика; организатору — его события. */
  bot.command('slots', async (ctx) => {
    if (!ctx.from || ctx.chat.type !== 'private') return;
    const user = await findUserByTelegramId(db, ctx.from.id);
    if (!user) return ctx.reply(t.notRegistered);
    const roles = await getUserRoles(db, user.id);
    const now = new Date();
    const toSlot = (r: Awaited<ReturnType<typeof listOpenEvents>>[number]): SlotEvent => ({
      title: r.event.title,
      venue: r.venue.name,
      startsAt: r.event.startsAt,
      timezone: r.venue.timezone,
      free: r.event.slotsCount - r.acceptedCount,
    });
    const messages: string[] = [];
    if (roles.includes('comedian')) {
      const profile = await findComedianProfile(db, user.id);
      const city = profile ? await findCity(db, profile.cityId) : undefined;
      if (!city) messages.push(t.slots.noCity);
      else {
        const open = await listOpenEvents(db, {
          cityId: city.id,
          from: now,
          to: daysAhead(SLOTS_DAYS),
        });
        messages.push(renderSlots(t.slots.title(city.name, SLOTS_DAYS), open.map(toSlot)));
      }
    }
    if (roles.includes('organizer')) {
      const own = await listOrganizerEvents(db, user.id, 'upcoming', now);
      messages.push(
        renderSlots(
          t.slots.titleOwn,
          own.filter((r) => r.event.status === 'recruiting').map(toSlot),
        ),
      );
    }
    if (messages.length === 0) return ctx.reply(t.notRegistered);
    const path = roles.includes('comedian') ? '/open' : '/my-events';
    await ctx.reply(messages.join('\n\n'), {
      reply_markup: openButton(t.slots.openList, path),
    });
  });

  bot.command('profile', async (ctx) => {
    if (!ctx.from || ctx.chat.type !== 'private') return;
    const user = await findUserByTelegramId(db, ctx.from.id);
    if (!user) return ctx.reply(t.notRegistered);
    const [comedian, organizer] = await Promise.all([
      findComedianProfile(db, user.id),
      findOrganizerProfile(db, user.id),
    ]);
    const cityName = async (id: number) => (await findCity(db, id))?.name ?? '—';
    const text = renderProfile({
      comedian: comedian
        ? {
            stageName: comedian.stageName,
            city: await cityName(comedian.cityId),
            category: ru.app.categories[comedian.category],
            contact: comedian.contact,
            bio: comedian.bio,
            links: comedian.links.map((l) => ({ label: ru.app.linkTypes[l.type], url: l.url })),
            photos: await countPhotos(db, user.id),
          }
        : null,
      organizer: organizer
        ? {
            displayName: organizer.displayName,
            city: await cityName(organizer.cityId),
            projectName: organizer.projectName,
            contact: organizer.contact,
          }
        : null,
    });
    await ctx.reply(text, {
      reply_markup: openButton(t.profile.edit, comedian || !organizer ? '/profile' : '/organizer'),
      link_preview_options: { is_disabled: true },
    });
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
      { command: 'schedule', description: t.commands.schedule },
      { command: 'slots', description: t.commands.slots },
      { command: 'profile', description: t.commands.profile },
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
