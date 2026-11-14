import { describe, expect, it } from 'vitest';
import { redactUrl } from './redact';

describe('redactUrl', () => {
  it('скрывает токены', () => {
    expect(redactUrl('/cal/secret.ics')).toBe('/cal/***');
    expect(redactUrl('/cal/secret')).toBe('/cal/***');
    expect(redactUrl('/api/v1/events/by-link/secret')).toBe('/api/v1/events/by-link/***');
  });

  it('остальные адреса не меняет', () => {
    expect(redactUrl('/api/v1/events?city=1')).toBe('/api/v1/events?city=1');
    expect(redactUrl('/health')).toBe('/health');
  });
});
