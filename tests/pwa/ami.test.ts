import { describe, it, expect } from 'vitest';
import { calcAmiBracket } from '../../src/pwa/lib/ami';

describe('calcAmiBracket', () => {
  it('weekly $400 for family of 1 → <30%', () => {
    // $400 × 52 = $20,800; t30(1) = $23,600
    expect(calcAmiBracket(400, 'weekly', 1)).toBe('<30%');
  });
  it('weekly $700 for family of 4 → 30-50%', () => {
    // $700 × 52 = $36,400; t30(4) = $33,700; t50(4) = $56,200
    expect(calcAmiBracket(700, 'weekly', 4)).toBe('30-50%');
  });
  it('monthly $3000 for family of 2 → 30-50%', () => {
    // $3,000 × 12 = $36,000; t30(2) = $27,000; t50(2) = $45,000
    expect(calcAmiBracket(3000, 'monthly', 2)).toBe('30-50%');
  });
  it('biweekly $1500 for family of 1 → 30-50%', () => {
    // $1,500 × 26 = $39,000; t30(1) = $23,600; t50(1) = $39,350
    expect(calcAmiBracket(1500, 'biweekly', 1)).toBe('30-50%');
  });
  it('biweekly $2000 for family of 1 → 50-80%', () => {
    // $2,000 × 26 = $52,000; t50(1) = $39,350; t80(1) = $62,950
    expect(calcAmiBracket(2000, 'biweekly', 1)).toBe('50-80%');
  });
  it('yearly $100000 for family of 2 → 80-120%', () => {
    // $100,000; t80(2) = $71,950; t120(2) = $108,000
    expect(calcAmiBracket(100000, 'yearly', 2)).toBe('80-120%');
  });
  it('yearly $200000 for family of 4 → >120%', () => {
    // $200,000; t120(4) = $134,880
    expect(calcAmiBracket(200000, 'yearly', 4)).toBe('>120%');
  });
  it('clamps at size 8 for large families', () => {
    // size 9 treated as 8: t30(8) = $44,500
    expect(calcAmiBracket(400, 'weekly', 9)).toBe('<30%');
  });
  it('clamps at size 1 for zero or negative family size', () => {
    // size 0 treated as 1: t30(1) = $23,600
    expect(calcAmiBracket(400, 'weekly', 0)).toBe('<30%');
  });
});
