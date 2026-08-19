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
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <input
        type="tel"
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus
        placeholder="(555) 555-5555"
      />
      <div className="step-actions">
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
        <button className="btn-ghost" onClick={onSkip}>
          I don't have one / No tengo
        </button>
        <button className="btn-primary" onClick={onNext}>
          Next / Siguiente
        </button>
      </div>
    </div>
  );
}
