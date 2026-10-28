import { describe, expect, it } from 'vitest';
import { botCanPost, joined } from './membership';

describe('botCanPost', () => {
  it.each([
    ['group', { status: 'member' }, true],
    ['supergroup', { status: 'member' }, true],
    ['supergroup', { status: 'administrator' }, true],
    ['channel', { status: 'member' }, false],
    ['channel', { status: 'administrator', can_post_messages: false }, false],
    ['channel', { status: 'administrator', can_post_messages: true }, true],
    ['supergroup', { status: 'restricted', can_send_messages: false }, false],
    ['supergroup', { status: 'restricted', can_send_messages: true }, true],
    ['group', { status: 'left' }, false],
    ['channel', { status: 'kicked' }, false],
    ['group', { status: 'creator' }, true],
  ] as const)('%s + %j → %s', (type, member, expected) => {
    expect(botCanPost(type, member)).toBe(expected);
  });
});

describe('joined', () => {
  it('добавление в чат', () => {
    expect(joined('left', 'member')).toBe(true);
    expect(joined('kicked', 'administrator')).toBe(true);
  });
  it('смена прав и удаление — не добавление', () => {
    expect(joined('member', 'administrator')).toBe(false);
    expect(joined('administrator', 'left')).toBe(false);
  });
});
