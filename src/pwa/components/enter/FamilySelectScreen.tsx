import { useState } from 'react';
import type { FamilySearchResult } from '../../lib/types';

interface FamilySelectScreenProps {
  own: FamilySearchResult | null;
  proxy: FamilySearchResult[];
  onConfirm: (selected: FamilySearchResult[]) => void;
  onBack: () => void;
}

export default function FamilySelectScreen({ own, proxy, onConfirm, onBack }: FamilySelectScreenProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const all = [
    ...(own ? [{ family: own, label: 'Their own family / Su propia familia' }] : []),
    ...proxy.map(f => ({ family: f, label: 'Also picking up for / También recogiendo para' })),
  ];

  function handleConfirm() {
    onConfirm(all.filter(({ family }) => selected.has(family.id)).map(({ family }) => family));
  }

  return (
    <div className="family-select">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <h2>Select families / Seleccionar familias</h2>
      </div>
      <p className="selection-count">{selected.size} selected / seleccionadas</p>
      {all.map(({ family, label }) => (
        <button
          key={family.id}
          className={`family-card${selected.has(family.id) ? ' selected' : ''}`}
          onClick={() => toggle(family.id)}
        >
          <span className="family-label">{label}</span>
          <span className="family-name">{family.name}</span>
          <span className="family-meta">
            {family.num_people ?? '?'} people
            {family.last_visit_date ? ` · Last: ${family.last_visit_date}` : ''}
          </span>
          <span className="checkbox">{selected.has(family.id) ? '☑' : '☐'}</span>
        </button>
      ))}
      <button
        className="btn-primary btn-large"
        onClick={handleConfirm}
        disabled={selected.size === 0}
      >
        Confirm / Confirmar ({selected.size})
      </button>
    </div>
  );
}
