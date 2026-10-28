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

// --- Посты в группы и каналы (анонсы событий) ---

export type PostResult = { status: 'ok'; messageId: number } | { status: 'failed'; error: string };

export interface ChatPoster {
  post(msg: OutgoingMessage): Promise<PostResult>;
  /** Обновить ранее опубликованный пост. */
  edit(
    msg: OutgoingMessage & { messageId: number },
  ): Promise<{ status: 'ok' } | { status: 'failed'; error: string }>;
}

function markup(buttons?: InlineButton[][]) {
  return buttons?.length
    ? {
        reply_markup: {
          inline_keyboard: buttons.map((row) =>
            row.map((b) =>
              b.url
                ? { text: b.text, url: b.url }
                : { text: b.text, callback_data: b.callbackData },
            ),
          ),
        },
      }
    : {};
}

export class BotApiPoster implements ChatPoster {
  constructor(private readonly token: string) {}

  private async call<T>(
    method: string,
    body: object,
  ): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; result: T; description?: string };
      return data.ok
        ? { ok: true, result: data.result }
        : { ok: false, error: data.description ?? String(res.status) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async post(msg: OutgoingMessage): Promise<PostResult> {
    const r = await this.call<{ message_id: number }>('sendMessage', {
      chat_id: msg.chatId,
      text: msg.text,
      link_preview_options: { is_disabled: true },
      ...markup(msg.buttons),
    });
    return r.ok
      ? { status: 'ok', messageId: r.result.message_id }
      : { status: 'failed', error: r.error };
  }

  async edit(msg: OutgoingMessage & { messageId: number }) {
    const r = await this.call('editMessageText', {
      chat_id: msg.chatId,
      message_id: msg.messageId,
      text: msg.text,
      link_preview_options: { is_disabled: true },
      ...markup(msg.buttons),
    });
    // «message is not modified» — текст не изменился, это не ошибка.
    if (r.ok || r.error.includes('message is not modified')) return { status: 'ok' as const };
    return { status: 'failed' as const, error: r.error };
  }
}

/** Тесты и dev без токена. */
export class MemoryPoster implements ChatPoster {
  readonly posts: Array<OutgoingMessage & { messageId: number }> = [];
  readonly edits: Array<OutgoingMessage & { messageId: number }> = [];
  private next = 1;

  async post(msg: OutgoingMessage): Promise<PostResult> {
    const messageId = this.next++;
    this.posts.push({ ...msg, messageId });
    return { status: 'ok', messageId };
  }

  async edit(msg: OutgoingMessage & { messageId: number }) {
    this.edits.push(msg);
    return { status: 'ok' as const };
  }
}
