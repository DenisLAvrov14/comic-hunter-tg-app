import pino from 'pino';

// Этап 1: заглушка. Планировщик scheduled_notifications и BullMQ-отправитель — этап 6.
const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const TICK_MS = 60_000;

function tick() {
  log.debug('scheduler tick');
}

const timer = setInterval(tick, TICK_MS);
log.info('worker started (scheduler not implemented yet)');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(timer);
    process.exit(0);
  });
}
