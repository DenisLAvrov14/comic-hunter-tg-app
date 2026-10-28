import { describe, expect, it } from 'vitest';
import { isValidStartParam, miniAppDirectLink } from './links';

describe('miniAppDirectLink', () => {
  it('строит ссылку со startapp', () => {
    expect(miniAppDirectLink('standup_bot', 'app', 'e_123')).toBe(
      'https://t.me/standup_bot/app?startapp=e_123',
    );
  });

  it('строит ссылку без параметра', () => {
    expect(miniAppDirectLink('standup_bot', 'app')).toBe('https://t.me/standup_bot/app');
  });

  it('возвращает null без username или short name', () => {
    expect(miniAppDirectLink('', 'app')).toBeNull();
    expect(miniAppDirectLink('bot', '')).toBeNull();
  });
});

describe('isValidStartParam', () => {
  it.each(['e_123', 'j_AbC-_9', 'i_1'])('принимает %s', (v) => {
    expect(isValidStartParam(v)).toBe(true);
  });

  it.each(['', 'x_1', 'e_', 'e_<script>', `e_${'a'.repeat(65)}`])('отклоняет %s', (v) => {
    expect(isValidStartParam(v)).toBe(false);
  });
});
