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
