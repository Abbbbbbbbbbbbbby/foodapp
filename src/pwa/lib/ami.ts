import type { AmiBracket } from './types';

export type PayPeriod = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

const MULTIPLIERS: Record<PayPeriod, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  yearly: 1,
};

// HUD 2026 income limits — effective June 1 2026
// Source: median_income_table_dev.pdf
interface AmiThresholds { t30: number; t50: number; t80: number; t120: number; }

const AMI_THRESHOLDS: Record<number, AmiThresholds> = {
  1: { t30:  23600, t50:  39350, t80:  62950, t120:  94440 },
  2: { t30:  27000, t50:  45000, t80:  71950, t120: 108000 },
  3: { t30:  30350, t50:  50600, t80:  80950, t120: 121440 },
  4: { t30:  33700, t50:  56200, t80:  89900, t120: 134880 },
  5: { t30:  36400, t50:  60700, t80:  97100, t120: 145680 },
  6: { t30:  39100, t50:  65200, t80: 104300, t120: 156480 },
  7: { t30:  41800, t50:  69700, t80: 111500, t120: 167280 },
  8: { t30:  44500, t50:  74200, t80: 118700, t120: 178080 },
};

function getThresholds(familySize: number): AmiThresholds {
  return AMI_THRESHOLDS[Math.min(Math.max(familySize, 1), 8)];
}

function fmtDollars(n: number): string {
  return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export interface IncomeRange {
  bracket: AmiBracket;
  labelEn: string;
  labelEs: string;
}

export function getIncomeRanges(period: PayPeriod, familySize: number): IncomeRange[] {
  const { t30, t50, t80, t120 } = getThresholds(familySize);
  const div = MULTIPLIERS[period];
  return [
    { bracket: '<30%',    labelEn: `Under ${fmtDollars(t30 / div)}`,                          labelEs: `Menos de ${fmtDollars(t30 / div)}` },
    { bracket: '30-50%',  labelEn: `${fmtDollars(t30 / div)} – ${fmtDollars(t50 / div)}`,    labelEs: `${fmtDollars(t30 / div)} – ${fmtDollars(t50 / div)}` },
    { bracket: '50-80%',  labelEn: `${fmtDollars(t50 / div)} – ${fmtDollars(t80 / div)}`,    labelEs: `${fmtDollars(t50 / div)} – ${fmtDollars(t80 / div)}` },
    { bracket: '80-120%', labelEn: `${fmtDollars(t80 / div)} – ${fmtDollars(t120 / div)}`,   labelEs: `${fmtDollars(t80 / div)} – ${fmtDollars(t120 / div)}` },
    { bracket: '>120%',   labelEn: `Over ${fmtDollars(t120 / div)}`,                          labelEs: `Más de ${fmtDollars(t120 / div)}` },
  ];
}

export function calcAmiBracket(
  amount: number,
  period: PayPeriod,
  familySize: number
): AmiBracket {
  const annual = amount * MULTIPLIERS[period];
  const { t30, t50, t80, t120 } = getThresholds(familySize);
  if (annual < t30)  return '<30%';
  if (annual < t50)  return '30-50%';
  if (annual < t80)  return '50-80%';
  if (annual < t120) return '80-120%';
  return '>120%';
}
