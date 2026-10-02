import { formatPhoneAsTyped } from '../../lib/phone';

interface ProxyIntroScreenProps {
  searchName: string;
  searchPhone: string | null;
  onAnswer: (hasMore: boolean) => void;
  onBack: () => void;
}

// Asked ONCE per batch, not per family: the proxy (who picks up) is assumed
// to be the same for every family being registered in this visit.
export default function ProxyIntroScreen({ searchName, searchPhone, onAnswer, onBack }: ProxyIntroScreenProps) {
  const who = [searchName, searchPhone ? formatPhoneAsTyped(searchPhone) : null].filter(Boolean).join(' · ');

  return (
    <div className="wizard-step">
      <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>

      {who && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          You entered: {who} / Usted ingresó: {who}
        </p>
      )}

      <p className="question-en">Is there anyone else that routinely picks up for these families?</p>
      <p className="question-es">¿Hay alguien más que recoja habitualmente los alimentos para estas familias?</p>

      <div className="option-list">
        <button className="btn-option" onClick={() => onAnswer(true)}>
          <span>Yes</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sí</span>
        </button>
        <button className="btn-option" onClick={() => onAnswer(false)}>
          <span>No</span>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No</span>
        </button>
      </div>
    </div>
  );
}
