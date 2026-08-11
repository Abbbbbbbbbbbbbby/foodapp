import { useState } from 'react';
import { api } from '../../lib/api';
import { setItemBag } from '../../lib/offline';

export interface SummaryFamily {
  id: string;
  name: string;
  num_people: number | null;
  bag_received: boolean | null;
  visitId: string | null;
  queueId: string | null; // offline queue entry id when the submission hasn't synced yet
}

interface SummaryScreenProps {
  families: SummaryFamily[];
  onNext: () => void;
}

// Families with more than 5 people count as two distribution slots
function distributionCount(families: SummaryFamily[]): number {
  return families.reduce((sum, f) => sum + ((f.num_people ?? 0) > 5 ? 2 : 1), 0);
}

export default function SummaryScreen({ families, onNext }: SummaryScreenProps) {
  const needBag = families.filter(f => !f.bag_received);

  const [bagsGiven, setBagsGiven] = useState(false);
  // Picklist selection — pre-checked: taking a bag is the common case,
  // volunteers uncheck the exceptions.
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(needBag.map((_, i) => i))
  );
  const [marking, setMarking] = useState(false);
  const [bagsSaved, setBagsSaved] = useState(false);
  const [savedPending, setSavedPending] = useState(0);
  const [bagError, setBagError] = useState<string | null>(null);

  const distCount = distributionCount(families);
  const hasLarge = families.some(f => (f.num_people ?? 0) > 5);
  const bagCount = bagsSaved ? 0 : needBag.length;

  function toggle(i: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function handleSaveBags() {
    setBagError(null);
    setMarking(true);
    const chosen = needBag.filter((_, i) => selected.has(i));
    const synced = chosen.filter(f => f.visitId);
    const queued = chosen.filter(f => !f.visitId && f.queueId);
    const unreachable = chosen.filter(f => !f.visitId && !f.queueId);
    // Settle per family: one failure must not block or misreport the others.
    const results = await Promise.allSettled([
      ...synced.map(f => api.patch(`/api/visits/${f.visitId}/bag`, { bag_received: true })),
      // Offline submissions: record the bag on the queued item — the flush
      // applies it to the visit after sync.
      ...queued.map(f => setItemBag(f.queueId!, true)),
    ]);
    const chosenOrdered = [...synced, ...queued];
    const failed: string[] = [];
    let alreadySynced = 0;
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        // The queue item synced between reaching this screen and tapping save:
        // the visit IS saved — the bag flag just can't ride the queue anymore.
        if (msg.includes('already synced') || msg.includes('not found')) alreadySynced++;
        else failed.push(`${chosenOrdered[i].name}: ${msg}`);
      }
    });
    const okCount = results.filter(r => r.status === 'fulfilled').length;
    if (okCount > 0) setBagsSaved(true);
    setSavedPending(queued.length - results.slice(synced.length).filter(r => r.status === 'rejected').length);
    const problems: string[] = [];
    if (alreadySynced > 0) {
      problems.push(
        `${alreadySynced} family record(s) finished syncing just now — the check-in IS saved, but the bag must be marked by staff from View Records.`
      );
    }
    if (failed.length > 0) problems.push(`Failed: ${failed.join('; ')} — check connection and retry.`);
    if (unreachable.length > 0) {
      problems.push(`${unreachable.length} record(s) could not be updated (the visit did not save) — note those manually.`);
    }
    setBagError(problems.length > 0 ? problems.join(' ') : null);
    setMarking(false);
  }

  const card: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  const bigNum: React.CSSProperties = {
    fontSize: 40,
    fontWeight: 700,
    lineHeight: 1,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <h2 style={{ fontSize: 22 }}>Summary / Resumen</h2>

      <div style={{ ...card, marginTop: 12 }}>
        <div>
          <p style={{ fontSize: 14, color: 'var(--text)' }}>Families checked in</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Familias registradas</p>
        </div>
        <span style={{ ...bigNum, color: 'var(--text)' }}>{families.length}</span>
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <div>
          <p style={{ fontSize: 14, color: 'var(--text)' }}>Distribution count</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Conteo de distribución</p>
          {hasLarge && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Families of 6+ count as 2 / Familias de 6+ cuentan como 2
            </p>
          )}
        </div>
        <span style={{ ...bigNum, color: 'var(--accent)' }}>{distCount}</span>
      </div>

      <div style={{ ...card, marginTop: 12 }}>
        <div>
          <p style={{ fontSize: 14, color: 'var(--text)' }}>Bags to give out</p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Bolsas a entregar</p>
          {bagsSaved && (
            <p style={{ fontSize: 11, color: 'var(--success)', marginTop: 2 }}>
              ✓ Recorded / Registradas
              {savedPending > 0 && ` (${savedPending} will upload with sync / se registrarán al sincronizar)`}
            </p>
          )}
        </div>
        <span style={{ ...bigNum, color: bagCount > 0 ? 'var(--accent)' : 'var(--success)' }}>
          {bagCount}
        </span>
      </div>

      {needBag.length > 0 && !bagsSaved && (
        <div style={{ marginTop: 12, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={bagsGiven}
              onChange={e => setBagsGiven(e.target.checked)}
              style={{ width: 22, height: 22, marginTop: 2 }}
            />
            <span>
              <span style={{ display: 'block', fontSize: 16 }}>Did they receive a reusable Creighton food bag?</span>
              <span style={{ display: 'block', fontSize: 16, color: 'var(--text-muted)' }}>¿Recibieron una bolsa reutilizable de Creighton?</span>
            </span>
          </label>

          {bagsGiven && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                Which families received a bag? / ¿Qué familias recibieron una bolsa?
              </p>
              {needBag.map((f, i) => (
                <label key={`${f.id || f.queueId || i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                    style={{ width: 22, height: 22 }}
                  />
                  <span style={{ fontSize: 15 }}>
                    {f.name}
                    {f.num_people != null && <span style={{ color: 'var(--text-muted)' }}> · {f.num_people} people</span>}
                    {!f.visitId && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> (pending sync)</span>}
                  </span>
                </label>
              ))}
              <button
                className="btn-secondary btn-large"
                style={{ marginTop: 8 }}
                onClick={handleSaveBags}
                disabled={marking || selected.size === 0}
              >
                {marking
                  ? 'Saving... / Guardando...'
                  : `Save bags (${selected.size}) / Guardar bolsas (${selected.size})`}
              </button>
            </div>
          )}
        </div>
      )}

      {bagError && (
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--error, #c0392b)', padding: '8px 12px', background: 'var(--error-bg, #fdecea)', borderRadius: 6 }}>
          {bagError}
        </p>
      )}

      <button className="btn-primary btn-large" style={{ marginTop: 12 }} onClick={onNext}>
        Next car / Siguiente carro
      </button>
    </div>
  );
}
