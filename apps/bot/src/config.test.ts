import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = { DATABASE_URL: 'postgres://x', BOT_TOKEN: '1:abc' };

describe('конфиг бота', () => {
  it('polling не требует настроек вебхука', () => {
    expect(loadConfig(base).BOT_MODE).toBe('polling');
  });

  it('webhook требует секрет и https-адрес', () => {
    const ok = {
      ...base,
      BOT_MODE: 'webhook',
      BOT_WEBHOOK_SECRET: 'a'.repeat(32),
      BOT_WEBHOOK_URL: 'https://example.kz/bot/webhook',
    };
    expect(loadConfig(ok).BOT_WEBHOOK_URL).toBe(ok.BOT_WEBHOOK_URL);
    expect(() => loadConfig({ ...ok, BOT_WEBHOOK_SECRET: '' })).toThrow(/BOT_WEBHOOK_SECRET/);
    expect(() => loadConfig({ ...ok, BOT_WEBHOOK_SECRET: 'bad secret with spaces!' })).toThrow(
      /BOT_WEBHOOK_SECRET/,
    );
    expect(() => loadConfig({ ...ok, BOT_WEBHOOK_URL: 'http://example.kz/bot/webhook' })).toThrow(
      /BOT_WEBHOOK_URL/,
    );
  });

  it('без токена бот не запускается и вебхук не проверяется', () => {
    expect(() => loadConfig({ ...base, BOT_TOKEN: '', BOT_MODE: 'webhook' })).not.toThrow();
  });
});
