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
  language?: string | null;
  noteEn?: string;
  noteEs?: string;
}

export default function SelectInput({ questionEn, questionEs, onChange, onBack, options, language, noteEn, noteEs }: SelectInputProps) {
  const isSpanish = language?.toLowerCase().startsWith('es');
  return (
    <div className="wizard-step">
      <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      {(noteEn || noteEs) && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: -4 }}>
          {isSpanish ? (noteEs ?? noteEn) : (noteEn ?? noteEs)}
        </p>
      )}
      <div className="option-list">
        {options.map(opt => {
          const primary = isSpanish ? opt.labelEs : opt.labelEn;
          const secondary = isSpanish ? opt.labelEn : opt.labelEs;
          const showSecondary = secondary && secondary !== primary;
          return (
            <button key={opt.value} className="btn-option" onClick={() => onChange(opt.value)}>
              <span>{primary}</span>
              {showSecondary && (
                <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{secondary}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
