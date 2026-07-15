import { describe, it, expect } from 'vitest';
import { calcAmiBracket, getAmi } from '../../src/pwa/lib/ami';

describe('getAmi', () => {
  it('returns correct AMI for family of 1', () => {
    expect(getAmi(1)).toBe(59347);
  });
  it('returns correct AMI for family of 4', () => {
    expect(getAmi(4)).toBe(125621);
  });
  it('clamps at 7 for large families', () => {
    expect(getAmi(8)).toBe(127820);
    expect(getAmi(10)).toBe(127820);
  });
});

describe('calcAmiBracket', () => {
  it('weekly $700 for family of 4 → <30%', () => {
    // $700 × 52 = $36,400; AMI(4) = $125,621; ratio = 28.97%
    expect(calcAmiBracket(700, 'weekly', 4)).toBe('<30%');
  });
  it('monthly $3000 for family of 2 → 30-50%', () => {
    // $3,000 × 12 = $36,000; AMI(2) = $94,640; ratio = 38.04%
    expect(calcAmiBracket(3000, 'monthly', 2)).toBe('30-50%');
  });
  it('biweekly $1500 for family of 1 → 50-80%', () => {
    // $1,500 × 26 = $39,000; AMI(1) = $59,347; ratio = 65.73%
    expect(calcAmiBracket(1500, 'biweekly', 1)).toBe('50-80%');
  });
  it('yearly $100000 for family of 2 → 80-120%', () => {
    // $100,000; AMI(2) = $94,640; ratio = 105.66%
    expect(calcAmiBracket(100000, 'yearly', 2)).toBe('80-120%');
  });
  it('yearly $200000 for family of 4 → >120%', () => {
    // $200,000; AMI(4) = $125,621; ratio = 159.21%
    expect(calcAmiBracket(200000, 'yearly', 4)).toBe('>120%');
  });
});
