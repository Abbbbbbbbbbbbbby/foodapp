import { useState } from 'react';
import { getIncomeRanges } from '../../../lib/ami';
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
  { value: 'weekly',   labelEn: 'Weekly / Semanal' },
  { value: 'biweekly', labelEn: 'Every 2 weeks / Cada 2 semanas' },
  { value: 'monthly',  labelEn: 'Monthly / Mensual' },
  { value: 'yearly',   labelEn: 'Yearly / Anual' },
];

export default function IncomeInput({ questionEn, questionEs, familySize, onChange, onBack, onSkip }: IncomeInputProps) {
  const [period, setPeriod] = useState<PayPeriod | null>(null);

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

  const ranges = getIncomeRanges(period, familySize);
  const periodLabel = PERIODS.find(p => p.value === period)?.labelEn ?? period;

  return (
    <div className="wizard-step">
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <p className="sub-question">{periodLabel} — select the closest range: / Seleccione el rango más cercano:</p>
      <div className="option-list">
        {ranges.map(r => (
          <button key={r.bracket} className="btn-option" onClick={() => onChange(r.bracket)}>
            <span>{r.labelEn}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{r.labelEs}</span>
          </button>
        ))}
      </div>
      <div className="step-actions">
        <button className="btn-ghost" onClick={() => setPeriod(null)}>Back / Atrás</button>
        <button className="btn-ghost" onClick={onSkip}>
          Don't know / Prefer not to say / No sé / Prefiero no responder
        </button>
      </div>
    </div>
  );
}
