interface TextInputProps {
  questionEn: string;
  questionEs: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip?: () => void;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

export default function TextInput({
  questionEn, questionEs, value, onChange, onNext, onBack, onSkip, required, inputMode = 'text',
}: TextInputProps) {
  return (
    <div className="wizard-step">
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus
      />
      <div className="step-actions">
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
        {onSkip && (
          <button className="btn-ghost" onClick={onSkip}>Skip / Omitir</button>
        )}
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
