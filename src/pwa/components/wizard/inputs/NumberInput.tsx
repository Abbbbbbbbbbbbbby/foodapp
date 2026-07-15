import { useState } from 'react';

interface NumberInputProps {
  questionEn: string;
  questionEs: string;
  onChange: (v: number) => void;
  onBack: () => void;
  options: number[];
  overflowLabel: string;
  overflowMin: number;
}

export default function NumberInput({
  questionEn, questionEs, onChange, onBack, options, overflowLabel, overflowMin,
}: NumberInputProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState('');

  if (showCustom) {
    const n = parseInt(custom);
    return (
      <div className="wizard-step">
        <p className="question-en">{questionEn}</p>
        <p className="question-es">{questionEs}</p>
        <input
          type="number"
          inputMode="numeric"
          min={overflowMin}
          value={custom}
          onChange={e => setCustom(e.target.value)}
          autoFocus
        />
        <div className="step-actions">
          <button className="btn-ghost" onClick={() => setShowCustom(false)}>Back / Atrás</button>
          <button
            className="btn-primary"
            onClick={() => { if (!isNaN(n) && n >= overflowMin) onChange(n); }}
            disabled={isNaN(n) || n < overflowMin}
          >
            Next / Siguiente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard-step">
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <div className="tap-grid">
        {options.map(n => (
          <button key={n} className="btn-tap" onClick={() => onChange(n)}>{n}</button>
        ))}
        <button className="btn-tap" onClick={() => setShowCustom(true)}>{overflowLabel}</button>
      </div>
      <div className="step-actions">
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
      </div>
    </div>
  );
}
