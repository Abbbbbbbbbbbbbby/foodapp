interface ConsentScreenProps {
  onContinue: () => void;
  onBack: () => void;
}

export default function ConsentScreen({ onContinue, onBack }: ConsentScreenProps) {
  return (
    <div className="wizard-step">
      <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>

      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 2 }}>Privacy Notice</h2>
        <p style={{ fontSize: 20, color: 'var(--text-muted)' }}>Aviso de privacidad</p>
      </div>

      <div>
        <p style={{ fontSize: 16, lineHeight: 1.5, marginBottom: 4 }}>Any information collected today will be kept private.</p>
        <p style={{ fontSize: 16, lineHeight: 1.5, color: 'var(--text-muted)' }}>Toda la información recopilada hoy se mantendrá privada.</p>
      </div>

      <div>
        <p style={{ fontSize: 16, lineHeight: 1.5, marginBottom: 4 }}>You may decline to answer any question.</p>
        <p style={{ fontSize: 16, lineHeight: 1.5, color: 'var(--text-muted)' }}>Puede negarse a responder cualquier pregunta.</p>
      </div>

      <button className="btn-primary btn-large" onClick={onContinue}>
        Continue / Continuar
      </button>
    </div>
  );
}
