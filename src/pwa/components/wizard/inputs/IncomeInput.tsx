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

const PERIODS: { value: PayPeriod; labelEn: string; labelEs: string }[] = [
  { value: 'weekly',   labelEn: 'Weekly',       labelEs: 'Semanal' },
  { value: 'biweekly', labelEn: 'Every 2 weeks', labelEs: 'Cada 2 semanas' },
  { value: 'monthly',  labelEn: 'Monthly',      labelEs: 'Mensual' },
  { value: 'yearly',   labelEn: 'Yearly',       labelEs: 'Anual' },
];

export default function IncomeInput({ questionEn, questionEs, familySize, onChange, onBack, onSkip }: IncomeInputProps) {
  const [period, setPeriod] = useState<PayPeriod | null>(null);

  if (!period) {
    return (
      <div className="wizard-step">
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
        <p className="question-en">{questionEn}</p>
        <p className="question-es">{questionEs}</p>
        <p className="sub-question">Choose a time period: / Elija un período:</p>
        <div className="option-list">
          {PERIODS.map(p => (
            <button key={p.value} className="btn-option" onClick={() => setPeriod(p.value)}>
              <span>{p.labelEn}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{p.labelEs}</span>
            </button>
          ))}
        </div>
        <button className="btn-option" onClick={onSkip}>
          <span>Don't know / Prefer not to say</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sé / Prefiero no responder</span>
        </button>
      </div>
    );
  }

  const ranges = getIncomeRanges(period, familySize);
  const periodLabel = PERIODS.find(p => p.value === period)?.labelEn ?? period;

  return (
    <div className="wizard-step">
      <button className="btn-ghost" onClick={() => setPeriod(null)}>Back / Atrás</button>
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
      <button className="btn-option" onClick={onSkip}>
        <span>Don't know / Prefer not to say</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sé / Prefiero no responder</span>
      </button>
    </div>
  );
}
