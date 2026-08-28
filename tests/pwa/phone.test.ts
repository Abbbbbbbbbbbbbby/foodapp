import { describe, it, expect } from 'vitest';
import { formatPhoneAsTyped } from '../../src/pwa/lib/phone';

describe('formatPhoneAsTyped', () => {
  it('formats progressively as digits are typed', () => {
    expect(formatPhoneAsTyped('')).toBe('');
    expect(formatPhoneAsTyped('4')).toBe('(4');
    expect(formatPhoneAsTyped('480')).toBe('(480');
    expect(formatPhoneAsTyped('4805')).toBe('(480) 5');
    expect(formatPhoneAsTyped('480555')).toBe('(480) 555');
    expect(formatPhoneAsTyped('4805550')).toBe('(480) 555-0');
    expect(formatPhoneAsTyped('4805550199')).toBe('(480) 555-0199');
  });

  it('caps at 10 digits, ignoring anything typed beyond that', () => {
    expect(formatPhoneAsTyped('48055501999999')).toBe('(480) 555-0199');
  });

  it('strips non-digit characters before formatting, so pasting a formatted number does not double up', () => {
    expect(formatPhoneAsTyped('(480) 555-0199')).toBe('(480) 555-0199');
    expect(formatPhoneAsTyped('480-555-0199')).toBe('(480) 555-0199');
  });

  it('re-stripping and re-formatting an already-formatted value is idempotent', () => {
    const once = formatPhoneAsTyped('4805550199');
    expect(formatPhoneAsTyped(once)).toBe(once);
  });
});
