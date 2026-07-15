interface HowManyFamiliesProps {
  onSelect: (count: number) => void;
  onBack: () => void;
}

export default function HowManyFamilies({ onSelect, onBack }: HowManyFamiliesProps) {
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
        <button className="btn-tap" style={{ fontSize: 32, padding: '24px 0' }} onClick={() => onSelect(4)}>
          4+
        </button>
      </div>
    </div>
  );
}
