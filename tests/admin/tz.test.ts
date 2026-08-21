import { describe, it, expect } from 'vitest';
import { azLocalToUtcIso, utcToAzLocalInputValue, utcToAzDisplay } from '../../src/admin/tz';

describe('azLocalToUtcIso', () => {
  it('treats a datetime-local value as America/Phoenix wall time (fixed UTC-7)', () => {
    // 2026-08-19 14:30 AZ time = 2026-08-19 21:30 UTC — no DST to account for.
    expect(azLocalToUtcIso('2026-08-19T14:30')).toBe('2026-08-19T21:30:00.000Z');
  });

  it('is stable across a date that would be DST in most US timezones (AZ has none)', () => {
    // June (DST season everywhere else) still converts by the same fixed -7.
    expect(azLocalToUtcIso('2026-06-15T00:00')).toBe('2026-06-15T07:00:00.000Z');
  });

  it('returns null for empty or garbage input rather than throwing', () => {
    expect(azLocalToUtcIso('')).toBeNull();
    expect(azLocalToUtcIso('not-a-date')).toBeNull();
  });

  it('rejects a calendar-invalid date instead of silently rolling it to the next month', () => {
    // Feb 30 doesn't exist — Date() would otherwise roll this to Mar 2.
    expect(azLocalToUtcIso('2026-02-30T10:00')).toBeNull();
  });
});

describe('utcToAzLocalInputValue', () => {
  it('is the inverse of azLocalToUtcIso for a round-trippable value', () => {
    const utc = azLocalToUtcIso('2026-08-19T14:30')!;
    expect(utcToAzLocalInputValue(utc)).toBe('2026-08-19T14:30');
  });

  it('parses a space-format timestamp (D1 datetime() default) the same as T-format', () => {
    expect(utcToAzLocalInputValue('2026-08-19 21:30:00')).toBe(utcToAzLocalInputValue('2026-08-19T21:30:00.000Z'));
  });
});

describe('utcToAzDisplay', () => {
  it('renders a human display string with an explicit MST label', () => {
    expect(utcToAzDisplay('2026-08-19T21:30:00.000Z')).toBe('2026-08-19 14:30 MST');
  });

  it('returns an empty string for null/undefined rather than throwing', () => {
    expect(utcToAzDisplay(null)).toBe('');
    expect(utcToAzDisplay(undefined)).toBe('');
  });
});
