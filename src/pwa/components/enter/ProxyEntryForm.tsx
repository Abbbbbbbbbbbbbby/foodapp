import { useState } from 'react';
import { formatPhoneAsTyped } from '../../lib/phone';

interface ProxyRow {
  name: string;
  phone: string; // as typed/formatted; normalized server-side
}

interface ProxyEntryFormProps {
  onContinue: (proxies: { name: string; phone: string | null }[]) => void;
  onBack: () => void;
}

// Collects the ADDITIONAL proxies beyond the person already entered at
// lookup (who's handled separately — see ProxyIntroScreen/EnterPage). At
// least one filled-in row is required; Continue strips any blank rows.
export default function ProxyEntryForm({ onContinue, onBack }: ProxyEntryFormProps) {
  const [rows, setRows] = useState<ProxyRow[]>([{ name: '', phone: '' }]);

  function setRow(i: number, patch: Partial<ProxyRow>) {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows(prev => [...prev, { name: '', phone: '' }]);
  }

  const filled = rows.filter(r => r.name.trim());
  const canContinue = filled.length > 0;

  function handleContinue() {
    onContinue(filled.map(r => ({ name: r.name.trim(), phone: r.phone.trim() || null })));
  }

  return (
    <div className="wizard-step">
      <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>

      <p className="question-en">Who else routinely picks up for these families?</p>
      <p className="question-es">¿Quién más recoge habitualmente los alimentos para estas familias?</p>

      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
          <label>
            Name / Nombre
            <input
              type="text"
              value={row.name}
              onChange={e => setRow(i, { name: e.target.value })}
              autoFocus={i === 0}
            />
          </label>
          <label>
            Phone (optional) / Teléfono (opcional)
            <input
              type="tel"
              inputMode="numeric"
              value={row.phone}
              onChange={e => setRow(i, { phone: formatPhoneAsTyped(e.target.value) })}
            />
          </label>
        </div>
      ))}

      <button className="btn-secondary" onClick={addRow}>
        + Add another person / Agregar otra persona
      </button>

      <div className="step-actions">
        <button className="btn-primary" disabled={!canContinue} onClick={handleContinue}>
          Next / Siguiente
        </button>
      </div>
    </div>
  );
}
