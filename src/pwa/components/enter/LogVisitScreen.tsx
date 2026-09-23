import { useState } from 'react';
import type { FamilySearchResult } from '../../lib/types';
import { api, ApiError } from '../../lib/api';
import { markDirectoryStale } from '../../lib/offline';
import { formatPhoneAsTyped } from '../../lib/phone';

interface LogVisitScreenProps {
  family: FamilySearchResult;
  total: number;
  current: number;
  onLogVisit: (familyId: string) => Promise<void>;
  // Lets the parent's view state reflect an inline edit (e.g. the summary
  // that follows log-visit) without a full re-search.
  onFamilyUpdated?: (id: string, patch: { name: string; phone: string | null; num_people: number | null }) => void;
}

// Quick-fix fields only — matches the server's allowedFamilyFields() for a
// volunteer. Anything beyond this (demographics, address, etc.) still
// requires the full Records page.
export default function LogVisitScreen({ family, total, current, onLogVisit, onFamilyUpdated }: LogVisitScreenProps) {
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The confirmation view's source of truth: starts from the prop, but a
  // successful save updates it immediately rather than waiting on the
  // parent to re-render with fresh props.
  const [display, setDisplay] = useState({
    name: family.name,
    phone: family.phone,
    num_people: family.num_people,
  });
  const [draft, setDraft] = useState({
    name: display.name,
    phone: formatPhoneAsTyped(display.phone ?? ''),
    num_people: display.num_people,
  });

  async function handleNoChange() {
    setLoading(true);
    await onLogVisit(family.id);
    setLoading(false);
  }

  function startEdit() {
    setDraft({
      name: display.name,
      phone: formatPhoneAsTyped(display.phone ?? ''),
      num_people: display.num_people,
    });
    setErr(null);
    setEditing(true);
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      setErr('Name cannot be empty / El nombre no puede estar vacío');
      return;
    }
    setSaving(true);
    setErr(null);
    const patch = {
      name: draft.name,
      phone: draft.phone.replace(/\D/g, '') || null,
      num_people: draft.num_people,
    };
    try {
      await api.patch(`/api/records/families/${family.id}`, patch);
      markDirectoryStale();
      onFamilyUpdated?.(family.id, patch);
      setDisplay(patch);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed. Check connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="log-visit">
      <p className="progress-label">Family {current + 1} of {total}</p>
      <div className="family-info-card">
        {editing ? (
          <div className="log-visit-edit-form">
            <label className="records-field-label">
              Name / Nombre
              <input
                type="text"
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              />
            </label>
            <label className="records-field-label">
              Phone / Teléfono
              <input
                type="tel"
                inputMode="numeric"
                value={draft.phone}
                onChange={e => setDraft(d => ({ ...d, phone: formatPhoneAsTyped(e.target.value) }))}
              />
            </label>
            <label className="records-field-label">
              Household size / Tamaño del hogar
              <input
                type="number"
                min={1}
                value={draft.num_people ?? ''}
                onChange={e => setDraft(d => ({ ...d, num_people: e.target.value ? Number(e.target.value) : null }))}
              />
            </label>
            {err && <p className="records-err">{err}</p>}
            <div className="records-edit-actions">
              <button className="records-save-btn" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving... / Guardando...' : 'Save / Guardar'}
              </button>
              <button className="btn-ghost" onClick={() => { setEditing(false); setErr(null); }} disabled={saving}>
                Cancel / Cancelar
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2>{display.name}</h2>
            {display.num_people && <p>{display.num_people} people in family</p>}
            {family.last_visit_date && <p>Last visit: {family.last_visit_date}</p>}
            {!family.last_visit_date && <p>First visit today</p>}
          </>
        )}
      </div>
      {!editing && (
        <div className="log-actions">
          <button className="btn-primary btn-large" onClick={handleNoChange} disabled={loading}>
            {loading ? 'Saving... / Guardando...' : 'No change / Sin cambios'}
          </button>
          <button className="btn-secondary" onClick={startEdit} disabled={loading}>
            Edit / Editar
          </button>
        </div>
      )}
    </div>
  );
}
