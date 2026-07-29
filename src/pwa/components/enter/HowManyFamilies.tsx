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
        <button className="btn-ghost" onClick={() => { setAskExact(false); setValue(''); }}>← Back</button>
        <p className="question-en">How many families?</p>
        <p className="question-es">¿Cuántas familias?</p>
        <input
          type="number"
          min={4}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="Enter number"
          autoFocus
          style={{ fontSize: 28, padding: '12px 16px', width: '100%', boxSizing: 'border-box', marginTop: 8 }}
        />
        <button
          className="btn-primary"
          style={{ marginTop: 16, width: '100%', fontSize: 18, padding: '14px 0' }}
          disabled={!valid}
          onClick={() => onSelect(num)}
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div className="how-many">
      <button className="btn-ghost" onClick={onBack}>← Back</button>
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
