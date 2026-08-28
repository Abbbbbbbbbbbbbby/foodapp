import { useState } from 'react';
import { markDirectoryStale } from '../../lib/offline';
import type { FamilySearchResult } from '../../lib/types';
import { api, ApiError } from '../../lib/api';

interface FamilySelectScreenProps {
  own: FamilySearchResult | null;
  proxy: FamilySearchResult[];
  pickupName: string;
  pickupPhone: string | null;
  // Rehydration after an inline registration round-trip
  initialExtra?: FamilySearchResult[];
  initialSelected?: string[];
  notice?: string;
  onConfirm: (selected: FamilySearchResult[]) => void;
  // Launch the registration wizard for a family the search can't find,
  // carrying the current selection so it survives the round-trip.
  onRegisterNew: (query: string, keep: { extra: FamilySearchResult[]; selectedIds: string[] }) => void;
  onBack: () => void;
}

export default function FamilySelectScreen({ own, proxy, pickupName, pickupPhone, initialExtra, initialSelected, notice, onConfirm, onRegisterNew, onBack }: FamilySelectScreenProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected ?? []));
  // Families added at the window that weren't already proxy-linked
  const [extra, setExtra] = useState<FamilySearchResult[]>(initialExtra ?? []);
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
    // Guard double-taps during the awaited POST and dedupe by id — a repeated
    // add would put the family in the pickup twice and log two visits.
    if (addBusy || extra.some(f => f.id === fam.id)) return;
    setAddBusy(true);
    // Persist the pickup authorization so this family appears automatically
    // next time (idempotent server-side). Requires the pickup person's phone
    // as the proxy key; without one the family is still added to THIS pickup.
    let persistError: string | null = null;
    if (pickupPhone) {
      try {
        // Name may be empty on a phone-only lookup — the phone is the
        // functional key, so the authorization persists either way.
        await api.post(`/api/families/${fam.id}/proxies`, {
          proxy_name: pickupName.trim() || null,
          proxy_phone: pickupPhone,
        });
        markDirectoryStale();
      } catch (e) {
        // Non-fatal: this pickup proceeds either way — but the panel must stay
        // open so the volunteer actually SEES that the save-for-next-time part
        // failed (closing it would hide the only place the error renders).
        persistError = e instanceof ApiError
          ? `${fam.name} was added for today, but couldn't be saved for next time: ${e.message}`
          : `${fam.name} was added for today, but couldn't be saved for next time (offline). It will need adding again on the next visit.`;
      }
    }
    setExtra(prev => (prev.some(f => f.id === fam.id) ? prev : [...prev, fam]));
    setSelected(prev => new Set(prev).add(fam.id));
    setAddQuery('');
    setAddResults(null);
    setAddBusy(false);
    setAddError(persistError);
    if (!persistError) setAdding(false); // keep the panel (and the message) open on failure
  }

  return (
    <div className="family-select">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <button className="btn-ghost" style={{ marginRight: 12 }} onClick={onBack}>Back / Atrás</button>
        <h2>Select families / Seleccionar familias</h2>
      </div>
      {notice && (
        <p style={{ fontSize: 13, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8 }}>
          {notice}
        </p>
      )}
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
              No match found. / No encontrada.
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
          {addResults !== null && (
            <button
              className="btn-secondary"
              style={{ marginTop: 8 }}
              onClick={() => onRegisterNew(addQuery.trim(), { extra, selectedIds: [...selected] })}
            >
              Register a new family / Registrar nueva familia
            </button>
          )}
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
