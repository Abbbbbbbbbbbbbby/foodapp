interface ConsentScreenProps {
  onContinue: () => void;
  onBack: () => void;
}

export default function ConsentScreen({ onContinue, onBack }: ConsentScreenProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 20, marginBottom: 4 }}>Privacy Notice</h2>
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Aviso de privacidad</p>
      </div>

      <p style={{ fontSize: 16, lineHeight: 1.6 }}>
        Any information collected today will be kept private and used only to
        coordinate food distribution.
      </p>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Toda la información recopilada hoy se mantendrá privada y se usará únicamente
        para coordinar la distribución de alimentos.
      </p>

      <p style={{ fontSize: 16, lineHeight: 1.6 }}>
        You may decline to answer any question.
      </p>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Puede negarse a responder cualquier pregunta.
      </p>

      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
        <button className="btn-primary btn-large" style={{ flex: 1 }} onClick={onContinue}>
          Continue / Continuar
        </button>
      </div>
    </div>
  );
}
