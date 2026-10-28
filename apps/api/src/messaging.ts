// Отправка сообщений в Telegram из API: рассылка составу и срочный вызов на замену.
// TODO(stage 6): перевести на scheduled_notifications + BullMQ с троттлингом и ретраями (SPEC §7.1).

export type SendResult = 'ok' | 'blocked' | 'failed';

export interface OutgoingMessage {
  chatId: number;
  text: string;
  /** URL-кнопка «Открыть» (прямая ссылка на Mini App). */
  button?: { text: string; url: string };
}

export interface MessageSender {
  send(msg: OutgoingMessage): Promise<SendResult>;
}

/** Bot API напрямую. Пауза между сообщениями держит общий темп ниже 25 в секунду. */
export class BotApiSender implements MessageSender {
  constructor(
    private readonly token: string,
    private readonly delayMs = 50,
  ) {}

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: msg.chatId,
        text: msg.text,
        ...(msg.button
          ? {
              reply_markup: { inline_keyboard: [[{ text: msg.button.text, url: msg.button.url }]] },
            }
          : {}),
      }),
    }).catch(() => null);
    await new Promise((r) => setTimeout(r, this.delayMs));
    if (!res) return 'failed';
    if (res.status === 403) return 'blocked';
    return res.ok ? 'ok' : 'failed';
  }
}

/** Без BOT_TOKEN (dev) и в тестах: запоминает сообщения, ничего не отправляет. */
export class MemorySender implements MessageSender {
  readonly sent: OutgoingMessage[] = [];
  /** chatId, которые «заблокировали бота». */
  readonly blocked = new Set<number>();

  async send(msg: OutgoingMessage): Promise<SendResult> {
    if (this.blocked.has(msg.chatId)) return 'blocked';
    this.sent.push(msg);
    return 'ok';
  }
}
