import { describe, it, expect } from 'vitest';
import { localDateString } from '../../src/pwa/lib/date';

describe('localDateString', () => {
  it('uses LOCAL calendar components — an evening date stays on its local day', () => {
    // 11:30 PM local on Aug 15 — a UTC-based slice would report Aug 16 in Phoenix
    expect(localDateString(new Date(2026, 7, 15, 23, 30))).toBe('2026-08-15');
  });
  it('zero-pads month and day', () => {
    expect(localDateString(new Date(2026, 0, 5, 8, 0))).toBe('2026-01-05');
  });
  it('defaults to now and returns YYYY-MM-DD shape', () => {
    expect(localDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
