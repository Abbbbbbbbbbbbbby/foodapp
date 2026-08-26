interface TextInputProps {
  questionEn: string;
  questionEs: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip?: () => void;
  required?: boolean;
  type?: 'text' | 'tel';
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

export default function TextInput({
  questionEn, questionEs, value, onChange, onNext, onBack, onSkip, required, type = 'text', inputMode = 'text',
}: TextInputProps) {
  return (
    <div className="wizard-step">
      <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus
      />
      {onSkip && (
        <button className="btn-option" onClick={onSkip}>
          <span>Don't know / Prefer not to say</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No sé / Prefiero no responder</span>
        </button>
      )}
      <div className="step-actions">
        <button
          className="btn-primary"
          onClick={onNext}
          disabled={required ? !value.trim() : false}
        >
          Next / Siguiente
        </button>
      </div>
    </div>
  );
}
