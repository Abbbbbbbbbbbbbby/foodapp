interface PhoneInputProps {
  questionEn: string;
  questionEs: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export default function PhoneInput({ questionEn, questionEs, value, onChange, onNext, onBack, onSkip }: PhoneInputProps) {
  return (
    <div className="wizard-step">
      <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <input
        type="tel"
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus
        placeholder="(555) 555-5555"
      />
      <button className="btn-option" onClick={onSkip}>
        <span>I don't have one / Prefer not to say</span>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No tengo / Prefiero no responder</span>
      </button>
      <div className="step-actions">
        <button className="btn-primary" onClick={onNext}>
          Next / Siguiente
        </button>
      </div>
    </div>
  );
}
