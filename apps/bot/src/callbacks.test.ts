import { describe, expect, it } from 'vitest';
import { apiRequestFor, parseCallback } from './callbacks';

const id = '0c65fc41-07bc-409d-8d6a-f3c02487494c';

describe('parseCallback', () => {
  it.each([
    [`dc:${id}:y`, { kind: 'day', participationId: id, value: 'confirmed' }],
    [`dc:${id}:n`, { kind: 'day', participationId: id, value: 'declined' }],
    [`iv:${id}:a`, { kind: 'invite', participationId: id, action: 'accept' }],
    [`iv:${id}:d`, { kind: 'invite', participationId: id, action: 'decline' }],
    [`rr:${id}`, { kind: 'reserve', participationId: id }],
  ])('%s', (data, expected) => {
    expect(parseCallback(data)).toEqual(expected);
  });

  it.each([
    undefined,
    '',
    'dc:x:y',
    `dc:${id}:z`,
    `iv:${id}`,
    `rr:${id}:x`,
    `xx:${id}`,
    `dc:${id.toUpperCase()}:y`,
  ])('мусор %j → null', (data) => {
    expect(parseCallback(data)).toBeNull();
  });

  it('укладывается в лимит Telegram 64 байта', () => {
    expect(Buffer.byteLength(`iv:${id}:a`)).toBeLessThanOrEqual(64);
  });
});

describe('apiRequestFor', () => {
  it('день выступления → day-confirmation', () => {
    expect(apiRequestFor({ kind: 'day', participationId: id, value: 'declined' })).toEqual({
      method: 'POST',
      path: `/participations/${id}/day-confirmation`,
      payload: { value: 'declined' },
    });
  });
  it('приглашение → действие над участием', () => {
    expect(apiRequestFor({ kind: 'invite', participationId: id, action: 'accept' })).toEqual({
      method: 'POST',
      path: `/participations/${id}/actions`,
      payload: { action: 'accept' },
    });
  });
  it('резерв → call-reserve', () => {
    expect(apiRequestFor({ kind: 'reserve', participationId: id })).toEqual({
      method: 'POST',
      path: `/participations/${id}/call-reserve`,
    });
  });
});
