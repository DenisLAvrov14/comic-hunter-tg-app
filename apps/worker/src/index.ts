import { DelayedError, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { createDb } from '@standup/db';
import {
  BotApiSender,
  MemorySender,
  claimDue,
  deliverNotification,
  postpone,
  type DeliveryContext,
} from '@standup/notify';
import { loadConfig } from './config';

// Уведомления (SPEC §7.1): планировщик раз в минуту забирает созревшие строки
// scheduled_notifications и ставит в очередь; отправитель шлёт с троттлингом.
const config = loadConfig();
const log = pino({ level: config.LOG_LEVEL });
const { db, close } = createDb(config.DATABASE_URL);
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const QUEUE = 'notifications';
const queue = new Queue<{ id: string }>(QUEUE, { connection });

if (!config.BOT_TOKEN)
  log.warn('BOT_TOKEN не задан — уведомления не отправляются, а копятся в памяти');
const sender = config.BOT_TOKEN ? new BotApiSender(config.BOT_TOKEN) : new MemorySender();

const ctx: DeliveryContext = {
  sender,
  links: { botUsername: config.BOT_USERNAME, miniAppShortName: config.MINIAPP_SHORT_NAME },
  now: () => new Date(),
  // Не больше одного сообщения в секунду в один чат (лимит Telegram).
  chatThrottle: async (chatId) => {
    const ok = await connection.set(`notify:chat:${chatId}`, '1', 'PX', 1000, 'NX');
    if (ok) return 0;
    const ttl = await connection.pttl(`notify:chat:${chatId}`);
    return Math.max(ttl, 50);
  },
};

async function tick() {
  try {
    const ids = await claimDue(db, new Date());
    if (ids.length === 0) return;
    // jobId = id уведомления: повторный claim не создаёт дублей в очереди.
    await queue.addBulk(ids.map((id) => ({ name: 'send', data: { id }, opts: { jobId: id } })));
    log.info({ count: ids.length }, 'notifications queued');
  } catch (err) {
    log.error({ err }, 'scheduler tick failed');
  }
}

const worker = new Worker<{ id: string }>(
  QUEUE,
  async (job, token) => {
    const outcome = await deliverNotification(db, job.data.id, ctx);
    if (outcome.status === 'retry') {
      // 429, лимит чата или временная ошибка: отложить задачу, а не считать её упавшей.
      await job.moveToDelayed(Date.now() + outcome.afterMs, token);
      throw new DelayedError();
    }
    return outcome.status;
  },
  {
    connection,
    concurrency: 5,
    // Не больше 25 сообщений в секунду суммарно.
    limiter: { max: 25, duration: 1000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
);
worker.on('failed', async (job, err) => {
  log.error({ err, id: job?.data.id }, 'notification job failed');
  // Неожиданная ошибка (БД, рендер) — вернём в pending через минуту, а не потеряем.
  if (job) await postpone(db, job.data.id, new Date(), 60_000).catch(() => {});
});

const timer = setInterval(tick, config.SCHEDULER_TICK_MS);
void tick();
log.info({ tickMs: config.SCHEDULER_TICK_MS }, 'worker started');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    clearInterval(timer);
    await worker.close();
    await queue.close();
    connection.disconnect();
    await close();
    process.exit(0);
  });
}
