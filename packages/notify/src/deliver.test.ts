import { describe, expect, it } from 'vitest';
import { notificationJobId } from './deliver';

describe('notificationJobId', () => {
  const id = '19b80f73-9c45-4a3e-b07d-110fb0514c5a';

  it('без двоеточия — BullMQ такие id отвергает', () => {
    expect(notificationJobId(id, new Date('2026-11-03T14:16:10.131Z'))).not.toContain(':');
  });

  it('заново поставленное уведомление — новая задача, повторный claim — та же', () => {
    const first = notificationJobId(id, new Date('2026-11-03T14:15:22Z'));
    expect(notificationJobId(id, new Date('2026-11-03T14:16:10Z'))).not.toBe(first);
    expect(notificationJobId(id, new Date('2026-11-03T14:15:22Z'))).toBe(first);
  });
});
