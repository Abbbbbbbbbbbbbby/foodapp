import { useState } from 'react';

interface HowManyFamiliesProps {
  onSelect: (count: number) => void;
  onBack: () => void;
}

export default function HowManyFamilies({ onSelect, onBack }: HowManyFamiliesProps) {
  const [askExact, setAskExact] = useState(false);
  const [value, setValue] = useState('');

  if (askExact) {
    const num = parseInt(value, 10);
    const valid = !isNaN(num) && num >= 4;
    return (
      <div className="how-many">
        <p className="question-en">How many families are you picking up for today?</p>
        <p className="question-es">¿Para cuántas familias está recogiendo hoy?</p>
        <input
          type="tel"
          inputMode="numeric"
          min={4}
          value={value}
          onChange={e => setValue(e.target.value)}
          autoFocus
        />
        <div className="step-actions">
          <button className="btn-ghost" onClick={() => { setAskExact(false); setValue(''); }}>Back / Atrás</button>
          <button
            className="btn-primary"
            disabled={!valid}
            onClick={() => onSelect(num)}
          >
            Next / Siguiente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="how-many">
      <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
      <p className="question-en">How many families are you picking up for today?</p>
      <p className="question-es">¿Para cuántas familias está recogiendo hoy?</p>
      <div className="tap-grid">
        {[1, 2, 3].map(n => (
          <button key={n} className="btn-tap" style={{ fontSize: 32, padding: '24px 0' }} onClick={() => onSelect(n)}>
            {n}
          </button>
        ))}
        <button className="btn-tap" style={{ fontSize: 32, padding: '24px 0' }} onClick={() => setAskExact(true)}>
          4+
        </button>
      </div>
    </div>
  );
}
