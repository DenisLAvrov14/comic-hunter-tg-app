import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const base = {
  DATABASE_URL: 'postgres://x',
  JWT_SECRET: 'x'.repeat(32),
  BOT_TOKEN: '123:abc',
};

describe('loadConfig', () => {
  it('принимает валидную конфигурацию', () => {
    const c = loadConfig({ ...base, DEV_AUTH: 'true' });
    expect(c.devAuth).toBe(true);
    expect(c.initDataMaxAgeSeconds).toBe(86400);
  });

  it('роняет старт при DEV_AUTH=true в production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DEV_AUTH: 'true' })).toThrow(
      /DEV_AUTH/,
    );
  });

  it('разрешает production без DEV_AUTH', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).devAuth).toBe(false);
  });

  it('требует BOT_TOKEN без DEV_AUTH', () => {
    expect(() => loadConfig({ ...base, BOT_TOKEN: '' })).toThrow(/BOT_TOKEN/);
  });

  it('требует длинный JWT_SECRET', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });
});
