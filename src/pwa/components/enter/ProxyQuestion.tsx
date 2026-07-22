import { useState } from 'react';
import type { ProxyData } from '../../lib/types';

interface ProxyQuestionProps {
  prefillName: string;
  prefillPhone: string | null;
  onAnswer: (proxy: ProxyData | null) => void;
  onBack: () => void;
}

export default function ProxyQuestion({ prefillName, prefillPhone, onAnswer, onBack }: ProxyQuestionProps) {
  const [showOther, setShowOther] = useState(false);
  const [otherName, setOtherName] = useState('');
  const [otherPhone, setOtherPhone] = useState('');

  if (showOther) {
    return (
      <div className="proxy-question">
        <button className="btn-ghost" onClick={() => setShowOther(false)}>← Back</button>
        <p className="question-en">Who is the designated pickup person?</p>
        <p className="question-es">¿Quién es la persona designada para recoger?</p>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label>
            Name / Nombre
            <input type="text" value={otherName} onChange={e => setOtherName(e.target.value)} autoFocus />
          </label>
          <label style={{ marginTop: 12 }}>
            Phone (optional) / Teléfono (opcional)
            <input type="tel" value={otherPhone} onChange={e => setOtherPhone(e.target.value)} />
          </label>
        </div>
        <div className="step-actions">
          <button
            className="btn-primary"
            onClick={() => onAnswer({ proxy_name: otherName, proxy_phone: otherPhone || null })}
            disabled={!otherName.trim()}
          >
            Next / Siguiente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="proxy-question">
      <button className="btn-ghost" onClick={onBack}>← Back</button>
      <p className="question-en">Who usually picks up food for this family?</p>
      <p className="question-es">¿Quién usualmente recoge los alimentos para esta familia?</p>
      <div className="option-list">
        <button
          className="btn-option"
          onClick={() => onAnswer({ proxy_name: prefillName, proxy_phone: prefillPhone })}
        >
          <span>The person here today / La persona aquí hoy</span>
          <span className="opt-detail">{prefillName}</span>
        </button>
        <button className="btn-option" onClick={() => setShowOther(true)}>
          Someone else / Otra persona
        </button>
        <button className="btn-option" onClick={() => onAnswer(null)}>
          No designated person / Sin persona designada
        </button>
      </div>
    </div>
  );
}
