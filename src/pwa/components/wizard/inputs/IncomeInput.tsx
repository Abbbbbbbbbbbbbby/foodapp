import { useState } from 'react';
import { calcAmiBracket } from '../../../lib/ami';
import type { PayPeriod } from '../../../lib/ami';
import type { AmiBracket } from '../../../lib/types';

interface IncomeInputProps {
  questionEn: string;
  questionEs: string;
  familySize: number;
  onChange: (bracket: AmiBracket) => void;
  onBack: () => void;
  onSkip: () => void;
}

const PERIODS: { value: PayPeriod; labelEn: string }[] = [
  { value: 'weekly', labelEn: 'Weekly / Semanal' },
  { value: 'biweekly', labelEn: 'Every 2 weeks / Cada 2 semanas' },
  { value: 'monthly', labelEn: 'Monthly / Mensual' },
  { value: 'yearly', labelEn: 'Yearly / Anual' },
];

export default function IncomeInput({ questionEn, questionEs, familySize, onChange, onBack, onSkip }: IncomeInputProps) {
  const [period, setPeriod] = useState<PayPeriod | null>(null);
  const [amount, setAmount] = useState('');

  if (!period) {
    return (
      <div className="wizard-step">
        <p className="question-en">{questionEn}</p>
        <p className="question-es">{questionEs}</p>
        <p className="sub-question">Choose a time period: / Elija un período:</p>
        <div className="option-list">
          {PERIODS.map(p => (
            <button key={p.value} className="btn-option" onClick={() => setPeriod(p.value)}>
              {p.labelEn}
            </button>
          ))}
        </div>
        <div className="step-actions">
          <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
          <button className="btn-ghost" onClick={onSkip}>
            Don't know / Prefer not to say / No sé / Prefiero no responder
          </button>
        </div>
      </div>
    );
  }

  const n = parseFloat(amount.replace(/[^0-9.]/g, ''));
  return (
    <div className="wizard-step">
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <p className="sub-question">Total from all earners in your household: / Total de todos los que trabajan en el hogar:</p>
      <div className="amount-input">
        <span className="currency">$</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0"
          autoFocus
        />
      </div>
      <div className="step-actions">
        <button className="btn-ghost" onClick={() => setPeriod(null)}>Back / Atrás</button>
        <button className="btn-ghost" onClick={onSkip}>
          Don't know / Prefer not to say / No sé / Prefiero no responder
        </button>
        <button
          className="btn-primary"
          onClick={() => { if (!isNaN(n) && n > 0) onChange(calcAmiBracket(n, period, familySize)); }}
          disabled={isNaN(n) || n <= 0}
        >
          Next / Siguiente
        </button>
      </div>
    </div>
  );
}
