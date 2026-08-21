import { useState } from 'react';
import type { ProxyData } from '../../lib/types';

interface ProxyQuestionProps {
  familyIndex: number;
  total: number;
  prefillName: string;
  prefillPhone: string | null;
  onAnswer: (proxy: ProxyData | null) => void;
  onBack: () => void;
}

const ORDINALS_EN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ORDINALS_ES = ['primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava', 'novena', 'décima'];

function familyLabel(index: number, total: number): { en: string; es: string } {
  if (total === 1) return { en: 'this family', es: 'esta familia' };
  const ordEn = ORDINALS_EN[index] ?? `${index + 1}th`;
  const ordEs = ORDINALS_ES[index] ?? `${index + 1}ª`;
  return { en: `the ${ordEn} family`, es: `la ${ordEs} familia` };
}

export default function ProxyQuestion({ familyIndex, total, prefillName, prefillPhone, onAnswer, onBack }: ProxyQuestionProps) {
  const [showOther, setShowOther] = useState(false);
  const [otherName, setOtherName] = useState('');
  const [otherPhone, setOtherPhone] = useState('');

  const label = familyLabel(familyIndex, total);

  const progressHeader = total > 1 ? (
    <div className="wizard-header">
      <p className="wizard-progress">Family {familyIndex + 1} of {total}</p>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${((familyIndex + 1) / total) * 100}%` }} />
      </div>
    </div>
  ) : null;

  if (showOther) {
    return (
      <div className="proxy-question">
        {progressHeader}
        <button className="btn-ghost" onClick={() => setShowOther(false)}>Back / Atrás</button>
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
      {progressHeader}
      <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
      <p className="question-en">Who usually picks up food for {label.en}?</p>
      <p className="question-es">¿Quién usualmente recoge los alimentos para {label.es}?</p>
      <div className="option-list">
        <button
          className="btn-option"
          onClick={() => onAnswer({ proxy_name: prefillName, proxy_phone: prefillPhone })}
        >
          <span>The person here today / La persona aquí hoy</span>
          <span className="opt-detail">{prefillName}</span>
        </button>
        <button className="btn-option" onClick={() => setShowOther(true)}>
          Someone else / Alguien diferente
        </button>
        <button className="btn-option" onClick={() => onAnswer(null)}>
          No designated person / Sin persona designada
        </button>
      </div>
    </div>
  );
}
