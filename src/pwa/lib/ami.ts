import type { AmiBracket } from './types';

export type PayPeriod = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

const MULTIPLIERS: Record<PayPeriod, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  yearly: 1,
};

const AMI_BY_SIZE: Record<number, number> = {
  1: 59347,
  2: 94640,
  3: 115062,
  4: 125621,
  5: 121268,
  6: 132321,
  7: 127820,
};

export function getAmi(familySize: number): number {
  return AMI_BY_SIZE[Math.min(Math.max(familySize, 1), 7)];
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
  const ami = getAmi(familySize);
  const div = MULTIPLIERS[period];
  const t30 = ami * 0.3 / div;
  const t50 = ami * 0.5 / div;
  const t80 = ami * 0.8 / div;
  const t120 = ami * 1.2 / div;
  return [
    { bracket: '<30%',    labelEn: `Under ${fmtDollars(t30)}`,                    labelEs: `Menos de ${fmtDollars(t30)}` },
    { bracket: '30-50%',  labelEn: `${fmtDollars(t30)} – ${fmtDollars(t50)}`,    labelEs: `${fmtDollars(t30)} – ${fmtDollars(t50)}` },
    { bracket: '50-80%',  labelEn: `${fmtDollars(t50)} – ${fmtDollars(t80)}`,    labelEs: `${fmtDollars(t50)} – ${fmtDollars(t80)}` },
    { bracket: '80-120%', labelEn: `${fmtDollars(t80)} – ${fmtDollars(t120)}`,   labelEs: `${fmtDollars(t80)} – ${fmtDollars(t120)}` },
    { bracket: '>120%',   labelEn: `Over ${fmtDollars(t120)}`,                    labelEs: `Más de ${fmtDollars(t120)}` },
  ];
}

export function calcAmiBracket(
  amount: number,
  period: PayPeriod,
  familySize: number
): AmiBracket {
  const annual = amount * MULTIPLIERS[period];
  const pct = annual / getAmi(familySize);
  if (pct < 0.3) return '<30%';
  if (pct < 0.5) return '30-50%';
  if (pct < 0.8) return '50-80%';
  if (pct < 1.2) return '80-120%';
  return '>120%';
}
