// Отправка в Telegram. Троттлинг и очередь — в worker; здесь один запрос и разбор ответа.

export interface InlineButton {
  text: string;
  url?: string;
  callbackData?: string;
}

export interface OutgoingMessage {
  chatId: number;
  text: string;
  /** Ряды inline-кнопок. */
  buttons?: InlineButton[][];
}

export type SendResult =
  | { status: 'ok' }
  /** 403: пользователь заблокировал бота. */
  | { status: 'blocked' }
  /** 429: Telegram просит подождать. */
  | { status: 'retry'; afterMs: number }
  | { status: 'failed'; error: string };

export interface MessageSender {
  send(msg: OutgoingMessage): Promise<SendResult>;
}

export class BotApiSender implements MessageSender {
  constructor(private readonly token: string) {}

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const body = {
      chat_id: msg.chatId,
      text: msg.text,
      link_preview_options: { is_disabled: true },
      ...(msg.buttons?.length
        ? {
            reply_markup: {
              inline_keyboard: msg.buttons.map((row) =>
                row.map((b) =>
                  b.url
                    ? { text: b.text, url: b.url }
                    : { text: b.text, callback_data: b.callbackData },
                ),
              ),
            },
          }
        : {}),
    };
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return { status: 'failed', error: (err as Error).message };
    }
    if (res.ok) return { status: 'ok' };
    const data = (await res.json().catch(() => ({}))) as {
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (res.status === 403) return { status: 'blocked' };
    if (res.status === 429) {
      return { status: 'retry', afterMs: (data.parameters?.retry_after ?? 1) * 1000 };
    }
    return { status: 'failed', error: `${res.status} ${data.description ?? ''}`.trim() };
  }
}

/** Dev без токена и тесты: сообщения копятся в памяти. */
export class MemorySender implements MessageSender {
  readonly sent: OutgoingMessage[] = [];
  /** chatId, «заблокировавшие бота». */
  readonly blocked = new Set<number>();

  async send(msg: OutgoingMessage): Promise<SendResult> {
    if (this.blocked.has(msg.chatId)) return { status: 'blocked' };
    this.sent.push(msg);
    return { status: 'ok' };
  }
}
