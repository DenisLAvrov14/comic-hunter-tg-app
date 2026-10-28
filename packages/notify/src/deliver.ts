import { eq, sql, schema, type Db } from '@standup/db';
import { retryDelayMs } from '@standup/domain';
import type { LinkConfig } from './links';
import { renderNotification } from './render';
import type { MessageSender } from './sender';

const { scheduledNotifications: sn, users } = schema;

export const MAX_ATTEMPTS = 6;

/**
 * Планировщик: забирает созревшие pending-уведомления (FOR UPDATE SKIP LOCKED — параллельные
 * планировщики не возьмут одно и то же) и помечает queued. Зависшие в queued дольше 10 минут
 * (упал отправитель) забираются повторно.
 */
export async function claimDue(db: Db, now: Date, limit = 500): Promise<string[]> {
  const at = now.toISOString();
  const rows = await db.execute<{ id: string }>(sql`
    update ${sn} set status = 'queued'
    where id in (
      select id from ${sn}
      where send_at <= ${at}::timestamptz
        and (status = 'pending'
          or (status = 'queued' and send_at <= ${at}::timestamptz - interval '10 minutes'))
      order by send_at
      limit ${limit}
      for update skip locked
    )
    returning id`);
  return rows.map((r) => r.id);
}

export type DeliveryOutcome =
  | { status: 'sent' | 'skipped' | 'failed' | 'gone' }
  /** Повторить позже (429, лимит на чат, временная ошибка). */
  | { status: 'retry'; afterMs: number };

export interface DeliveryContext {
  sender: MessageSender;
  links: LinkConfig;
  now: () => Date;
  /** Лимит «1 сообщение в секунду в чат»: сколько ждать перед отправкой в этот чат (0 — можно). */
  chatThrottle?: (chatId: number) => Promise<number>;
}

/** Отправка одного уведомления с учётом ответа Telegram. */
export async function deliverNotification(
  db: Db,
  id: string,
  ctx: DeliveryContext,
): Promise<DeliveryOutcome> {
  const [n] = await db.select().from(sn).where(eq(sn.id, id));
  if (!n || (n.status !== 'queued' && n.status !== 'pending')) return { status: 'gone' };

  const rendered = await renderNotification(db, n, ctx.links);
  if ('skip' in rendered) {
    await db.update(sn).set({ status: 'cancelled', lastError: rendered.skip }).where(eq(sn.id, id));
    return { status: 'skipped' };
  }

  const wait = (await ctx.chatThrottle?.(rendered.message.chatId)) ?? 0;
  if (wait > 0) return { status: 'retry', afterMs: wait };

  const result = await ctx.sender.send(rendered.message);
  if (result.status === 'ok') {
    await db
      .update(sn)
      .set({
        status: 'sent',
        sentAt: ctx.now(),
        payload: { ...n.payload, ...(rendered.payload ?? {}) },
        attempts: n.attempts + 1,
      })
      .where(eq(sn.id, id));
    return { status: 'sent' };
  }
  if (result.status === 'blocked') {
    await db.update(users).set({ botBlocked: true }).where(eq(users.id, n.userId));
    await db
      .update(sn)
      .set({ status: 'failed', lastError: 'bot_blocked', attempts: n.attempts + 1 })
      .where(eq(sn.id, id));
    return { status: 'failed' };
  }
  if (result.status === 'retry') {
    // 429 — не ошибка доставки: попытку не считаем, ждём сколько просит Telegram.
    return { status: 'retry', afterMs: result.afterMs };
  }
  const attempts = n.attempts + 1;
  const final = attempts >= MAX_ATTEMPTS;
  await db
    .update(sn)
    .set({ attempts, lastError: result.error, ...(final ? { status: 'failed' as const } : {}) })
    .where(eq(sn.id, id));
  return final ? { status: 'failed' } : { status: 'retry', afterMs: retryDelayMs(attempts) };
}

/**
 * Без очереди: забрать созревшие и отправить по порядку. Для тестов с подменой времени
 * и для запуска без Redis. Повторы откладываются: строка возвращается в pending на `now + afterMs`.
 */
export async function runDueOnce(db: Db, ctx: DeliveryContext): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};
  for (const id of await claimDue(db, ctx.now())) {
    const outcome = await deliverNotification(db, id, ctx);
    stats[outcome.status] = (stats[outcome.status] ?? 0) + 1;
    if (outcome.status === 'retry') await postpone(db, id, ctx.now(), outcome.afterMs);
  }
  return stats;
}

/** Вернуть уведомление в pending с отсрочкой. */
export async function postpone(db: Db, id: string, now: Date, afterMs: number) {
  await db
    .update(sn)
    .set({ status: 'pending', sendAt: new Date(now.getTime() + afterMs) })
    .where(eq(sn.id, id));
}
