import { useState } from 'react';
import type { FamilySearchResult } from '../../lib/types';
import { api, ApiError } from '../../lib/api';

interface FamilySelectScreenProps {
  own: FamilySearchResult | null;
  proxy: FamilySearchResult[];
  pickupName: string;
  pickupPhone: string | null;
  onConfirm: (selected: FamilySearchResult[]) => void;
  onBack: () => void;
}

export default function FamilySelectScreen({ own, proxy, pickupName, pickupPhone, onConfirm, onBack }: FamilySelectScreenProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Families added at the window that weren't already proxy-linked
  const [extra, setExtra] = useState<FamilySearchResult[]>([]);
  const [adding, setAdding] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<FamilySearchResult[] | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

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
    ...extra.map(f => ({ family: f, label: 'Also picking up for / También recogiendo para' })),
  ];

  function handleConfirm() {
    onConfirm(all.filter(({ family }) => selected.has(family.id)).map(({ family }) => family));
  }

  async function handleAddSearch() {
    const q = addQuery.trim();
    if (q.length < 2) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const { results } = await api.get<{ results: FamilySearchResult[] }>(
        '/api/families/search?name=' + encodeURIComponent(q)
      );
      const shownIds = new Set(all.map(({ family }) => family.id));
      setAddResults(results.filter(r => !shownIds.has(r.id)));
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : 'Network error. Check connection and try again.');
    } finally {
      setAddBusy(false);
    }
  }

  async function handleAddFamily(fam: FamilySearchResult) {
    // Persist the pickup authorization so this family appears automatically
    // next time (idempotent server-side). Requires the pickup person's phone
    // as the proxy key; without one the family is still added to THIS pickup.
    if (pickupPhone) {
      try {
        await api.post(`/api/families/${fam.id}/proxies`, {
          proxy_name: pickupName,
          proxy_phone: pickupPhone,
        });
      } catch (e) {
        // Non-fatal: this pickup proceeds either way; surface so the volunteer
        // knows the shortcut won't exist next time.
        setAddError(e instanceof ApiError
          ? `Added for today, but couldn't save for next time: ${e.message}`
          : 'Added for today, but couldn\'t save for next time (offline). It will need adding again.');
      }
    }
    setExtra(prev => [...prev, fam]);
    setSelected(prev => new Set(prev).add(fam.id));
    setAdding(false);
    setAddQuery('');
    setAddResults(null);
  }

  return (
    <div className="family-select">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <button className="btn-ghost" style={{ marginRight: 12 }} onClick={onBack}>← Back</button>
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

      {!adding && (
        <button className="btn-secondary" style={{ marginTop: 4, marginBottom: 8 }} onClick={() => setAdding(true)}>
          + Add another family / Agregar otra familia
        </button>
      )}

      {adding && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 12, marginBottom: 8 }}>
          <p style={{ fontSize: 14, marginBottom: 6 }}>
            Which family are they also picking up for? / ¿Para qué otra familia recogen?
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={addQuery}
              onChange={e => setAddQuery(e.target.value)}
              placeholder="Family name / Nombre"
              style={{ flex: 1 }}
            />
            <button className="btn-secondary" onClick={handleAddSearch} disabled={addBusy || addQuery.trim().length < 2}>
              {addBusy ? '...' : 'Search / Buscar'}
            </button>
          </div>
          {addResults !== null && addResults.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
              No match found. Finish this pickup, then register them as a new family. /
              No encontrada. Termine esta recogida y regístrela como familia nueva.
            </p>
          )}
          {addResults !== null && addResults.map(r => (
            <button key={r.id} className="family-card" style={{ marginTop: 8 }} onClick={() => handleAddFamily(r)}>
              <span className="family-name">{r.name}</span>
              <span className="family-meta">
                {r.num_people ?? '?'} people
                {r.last_visit_date ? ` · Last: ${r.last_visit_date}` : ''}
              </span>
              <span className="checkbox">＋</span>
            </button>
          ))}
          {addError && <p style={{ fontSize: 13, color: 'var(--error, #c0392b)', marginTop: 8 }}>{addError}</p>}
          <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => { setAdding(false); setAddQuery(''); setAddResults(null); setAddError(null); }}>
            Cancel / Cancelar
          </button>
        </div>
      )}

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
