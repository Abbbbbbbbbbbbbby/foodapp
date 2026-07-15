interface Option {
  value: string;
  labelEn: string;
  labelEs: string;
}

interface SelectInputProps {
  questionEn: string;
  questionEs: string;
  onChange: (v: string) => void;
  onBack: () => void;
  options: Option[];
}

export default function SelectInput({ questionEn, questionEs, onChange, onBack, options }: SelectInputProps) {
  return (
    <div className="wizard-step">
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <div className="option-list">
        {options.map(opt => (
          <button key={opt.value} className="btn-option" onClick={() => onChange(opt.value)}>
            <span>{opt.labelEn}</span>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{opt.labelEs}</span>
          </button>
        ))}
      </div>
      <div className="step-actions" style={{ marginTop: 8 }}>
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
      </div>
    </div>
  );
}
