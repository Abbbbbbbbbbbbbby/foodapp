import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  calculateAmiBracket,
  mapHispanic,
  mapYesNo,
  annualizeIncome,
} from '../../scripts/migrate-bubble.js';

describe('normalizePhone', () => {
  it('strips non-digits', () => {
    expect(normalizePhone('(602) 555-1234')).toBe('6025551234');
  });
  it('returns null for empty/null', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
  it('returns null for anything that is not exactly 10 digits (runtime search rule)', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('555-1234')).toBeNull();       // 7 digits — unfindable at runtime
    expect(normalizePhone('480555123456')).toBeNull();    // 12 digits
  });
  it('strips a leading 1 from 11-digit numbers', () => {
    expect(normalizePhone('1-480-555-1234')).toBe('4805551234');
  });
});

describe('calculateAmiBracket', () => {
  it('returns <30% for income well below 30% AMI (family of 4)', () => {
    expect(calculateAmiBracket(20000, 4)).toBe('<30%');
  });
  it('returns 30-50% for income in that range (family of 4)', () => {
    expect(calculateAmiBracket(50000, 4)).toBe('30-50%');
  });
  it('returns 50-80% correctly', () => {
    expect(calculateAmiBracket(75000, 4)).toBe('50-80%');
  });
  it('returns 80-120% correctly', () => {
    // 88% of $125,621 (4-person AMI) — $100,000 is only 79.6% (50-80% bracket)
    expect(calculateAmiBracket(110000, 4)).toBe('80-120%');
  });
  it('returns >120% correctly', () => {
    expect(calculateAmiBracket(200000, 4)).toBe('>120%');
  });
  it('uses 7+ threshold for families larger than 7', () => {
    expect(calculateAmiBracket(20000, 10)).toBe('<30%');
  });
  it('uses 1-person threshold for single-person household', () => {
    expect(calculateAmiBracket(10000, 1)).toBe('<30%');
    expect(calculateAmiBracket(50000, 1)).toBe('80-120%');
  });
  it('returns declined for null income', () => {
    expect(calculateAmiBracket(null, 4)).toBe('declined');
  });
});

describe('annualizeIncome', () => {
  it('multiplies weekly by 52', () => {
    expect(annualizeIncome(500, 'weekly')).toBe(26000);
  });
  it('multiplies biweekly by 26', () => {
    expect(annualizeIncome(1000, 'biweekly')).toBe(26000);
  });
  it('multiplies monthly by 12', () => {
    expect(annualizeIncome(2000, 'monthly')).toBe(24000);
  });
  it('returns yearly as-is', () => {
    expect(annualizeIncome(30000, 'yearly')).toBe(30000);
  });
  it('returns null for null amount', () => {
    expect(annualizeIncome(null, 'monthly')).toBeNull();
  });
});

describe('mapHispanic', () => {
  it('maps yes/no/unavailable correctly', () => {
    expect(mapHispanic('yes')).toBe('yes');
    expect(mapHispanic('no')).toBe('no');
    expect(mapHispanic(null)).toBeNull();
    expect(mapHispanic('unavailable')).toBe('declined');
    expect(mapHispanic('')).toBeNull();
  });
});

describe('mapYesNo', () => {
  it('maps truthy text to yes', () => {
    expect(mapYesNo('yes')).toBe('yes');
    expect(mapYesNo('no')).toBe('no');
    expect(mapYesNo('unavailable')).toBe('declined');
    expect(mapYesNo(null)).toBeNull();
  });
});

describe('generateMigration pipeline', () => {
  const bubbleData = { user_types: { t1: { name: 'user' }, t2: { name: 'family_data' } } };
  const csv = [
    '"Name","Phone","Proxy","ProxyPhone"',
    '"García Family","(480) 555-1234","Helper Uno","480-555-9999"',
    '"Short Phone Fam","555-12","",""',
    '"No Phone Fam","","",""',
    '"","4805550000","",""',  // nameless row — dropped
  ].join('\n');

  it('emits families with accent-folded name_normalized', async () => {
    const { generateMigration } = await import('../../scripts/migrate-bubble.js');
    const out = generateMigration(bubbleData, csv);
    const famLine = out.lines.find(l => l.includes("'García Family'"));
    expect(famLine).toBeTruthy();
    expect(famLine).toContain("'garcia family'"); // NFD-folded, lowercased
    expect(famLine).toContain("'4805551234'");    // normalized phone
  });

  it('reports dropped phones with context instead of silently nulling', async () => {
    const { generateMigration } = await import('../../scripts/migrate-bubble.js');
    const out = generateMigration(bubbleData, csv);
    expect(out.droppedPhones.length).toBe(1);
    expect(out.droppedPhones[0].raw).toBe('555-12');
    expect(out.droppedPhones[0].context).toContain('Short Phone Fam');
  });

  it('counts match emitted rows; nameless rows are excluded', async () => {
    const { generateMigration } = await import('../../scripts/migrate-bubble.js');
    const out = generateMigration(bubbleData, csv);
    expect(out.familyCount).toBe(3);
    expect(out.proxyCount).toBe(1);
    expect(out.userCount).toBe(1);
    const insertCount = out.lines.filter(l => l.includes('INSERT OR IGNORE INTO families')).length;
    expect(insertCount).toBe(3);
  });

  it('wraps everything in a transaction with a summary trailer', async () => {
    const { generateMigration } = await import('../../scripts/migrate-bubble.js');
    const out = generateMigration(bubbleData, csv);
    expect(out.lines[1]).toBe('BEGIN TRANSACTION;');
    expect(out.lines).toContain('COMMIT;');
    expect(out.lines[out.lines.length - 1]).toContain('-- Summary: 1 users, 3 families');
  });
});
