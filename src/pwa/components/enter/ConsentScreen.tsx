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
        <p style={{ fontSize: 16, lineHeight: 1.5, marginBottom: 4 }}>Any information you provide today will only be used for reporting and funding purposes and will be stored securely with limited access. You will remain anonymous where possible.</p>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>La información que proporcione hoy se usará únicamente para fines de informes y financiamiento, y se almacenará de forma segura con acceso limitado. Usted permanecerá anónimo cuando sea posible.</p>
      </div>

      <div>
        <p style={{ fontSize: 16, lineHeight: 1.5, marginBottom: 4 }}>The only required questions to receive services are name, zip code, and number of people in the household. You may decline to answer any other questions, which will not affect your ability to receive food.</p>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>Las únicas preguntas obligatorias para recibir los servicios son el nombre, el código postal y el número de personas en el hogar. Puede negarse a responder cualquier otra pregunta, lo cual no afectará su capacidad de recibir alimentos.</p>
      </div>

      <div>
        <p style={{ fontSize: 16, lineHeight: 1.5, marginBottom: 4 }}>If you have any questions you can call us at the number listed on the flyer you received today.</p>
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>Si tiene alguna pregunta, puede llamarnos al número que aparece en el folleto que recibió hoy.</p>
      </div>

      <button className="btn-primary btn-large" onClick={onContinue}>
        Continue / Continuar
      </button>
    </div>
  );
}
