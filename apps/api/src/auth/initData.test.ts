import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from './initData';

const BOT_TOKEN = '123456:TEST-token';
const NOW = new Date('2026-10-28T12:00:00Z');
const MAX_AGE = 24 * 60 * 60;
const user = { id: 42, first_name: 'Иван', username: 'ivan', language_code: 'ru' };

function makeInitData(
  fields: Record<string, string>,
  token = BOT_TOKEN,
): { raw: string; params: URLSearchParams } {
  const params = new URLSearchParams(fields);
  params.set('hash', signInitData(params, token));
  return { raw: params.toString(), params };
}

const authDate = (d: Date) => String(Math.floor(d.getTime() / 1000));

describe('verifyInitData', () => {
  it('принимает валидные данные', () => {
    const { raw } = makeInitData({
      query_id: 'AAH',
      user: JSON.stringify(user),
      auth_date: authDate(NOW),
      start_param: 'e_123',
    });
    const res = verifyInitData(raw, BOT_TOKEN, { maxAgeSeconds: MAX_AGE, now: NOW });
    expect(res).toEqual({
      ok: true,
      data: { user, authDate: NOW, startParam: 'e_123' },
    });
  });

  it('отклоняет подделанные данные (изменён user после подписи)', () => {
    const { params } = makeInitData({ user: JSON.stringify(user), auth_date: authDate(NOW) });
    params.set('user', JSON.stringify({ ...user, id: 1 }));
    const res = verifyInitData(params.toString(), BOT_TOKEN, { maxAgeSeconds: MAX_AGE, now: NOW });
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('отклоняет подпись чужим токеном бота', () => {
    const { raw } = makeInitData(
      { user: JSON.stringify(user), auth_date: authDate(NOW) },
      '999:other',
    );
    const res = verifyInitData(raw, BOT_TOKEN, { maxAgeSeconds: MAX_AGE, now: NOW });
    expect(res).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('отклоняет просроченные данные (старше 24 часов)', () => {
    const old = new Date(NOW.getTime() - (MAX_AGE + 1) * 1000);
    const { raw } = makeInitData({ user: JSON.stringify(user), auth_date: authDate(old) });
    const res = verifyInitData(raw, BOT_TOKEN, { maxAgeSeconds: MAX_AGE, now: NOW });
    expect(res).toEqual({ ok: false, reason: 'expired' });
  });

  it('принимает данные ровно на границе срока', () => {
    const edge = new Date(NOW.getTime() - MAX_AGE * 1000);
    const { raw } = makeInitData({ user: JSON.stringify(user), auth_date: authDate(edge) });
    expect(verifyInitData(raw, BOT_TOKEN, { maxAgeSeconds: MAX_AGE, now: NOW }).ok).toBe(true);
  });

  it('отклоняет данные без hash или auth_date', () => {
    const opts = { maxAgeSeconds: MAX_AGE, now: NOW };
    expect(verifyInitData('user=%7B%7D', BOT_TOKEN, opts)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyInitData(`auth_date=1&hash=${'a'.repeat(64)}`, BOT_TOKEN, opts)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(verifyInitData('', BOT_TOKEN, opts)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('отклоняет валидную подпись без пользователя', () => {
    const { raw } = makeInitData({ auth_date: authDate(NOW) });
    expect(verifyInitData(raw, BOT_TOKEN, { maxAgeSeconds: MAX_AGE, now: NOW })).toEqual({
      ok: false,
      reason: 'no_user',
    });
  });
});
