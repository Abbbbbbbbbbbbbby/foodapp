interface ConsentScreenProps {
  onContinue: () => void;
  onBack: () => void;
}

export default function ConsentScreen({ onContinue, onBack }: ConsentScreenProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <button className="btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={onBack}>Back / Atrás</button>

      <div>
        <h2 style={{ fontSize: 20, marginBottom: 4 }}>Privacy Notice</h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Aviso de privacidad</p>
      </div>

      <p style={{ fontSize: 16, lineHeight: 1.6 }}>
        Any information collected today will be kept private.
      </p>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Toda la información recopilada hoy se mantendrá privada.
      </p>

      <p style={{ fontSize: 16, lineHeight: 1.6 }}>
        You may decline to answer any question.
      </p>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Puede negarse a responder cualquier pregunta.
      </p>

      <button className="btn-primary btn-large" onClick={onContinue}>
        Continue / Continuar
      </button>
    </div>
  );
}
