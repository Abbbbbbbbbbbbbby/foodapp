import { useState } from 'react';
import { apiWithToken } from '../../lib/api';
import { getAuth } from '../../store/auth';
import { setItemBag } from '../../lib/offline';

export interface SummaryFamily {
  id: string;
  name: string;
  num_people: number | null;
  bag_received: boolean | null;
  visitId: string | null;
  queueId: string | null;  // offline queue entry id when the submission hasn't synced yet
  visitKey: string | null; // visit idempotency key — lets the bag be recovered after a mid-flow sync
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
  // Indices (into needBag) whose bag status was successfully recorded, and how
  // many of those rode a still-pending queue item. Per-family so a partial
  // failure keeps ONLY the failed families visible for retry.
  const [savedIdx, setSavedIdx] = useState<Set<number>>(new Set());
  const [savedPending, setSavedPending] = useState(0);
  const [bagError, setBagError] = useState<string | null>(null);

  const distCount = distributionCount(families);
  const hasLarge = families.some(f => (f.num_people ?? 0) > 5);
  const remainingIdx = needBag.map((_, i) => i).filter(i => !savedIdx.has(i));
  const bagsSaved = savedIdx.size > 0;
  const bagCount = remainingIdx.length;

  function toggle(i: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function handleSaveBags() {
    setBagError(null);
    // One identity for the whole save (same contract as the submission
    // handlers): the bag PATCHes and the resolve-recovery reads must all
    // carry the token of whoever clicked, or a cross-tab switch mid-handler
    // audit-attributes this user's bags to someone else.
    const auth = getAuth();
    if (!auth) {
      setBagError('Session ended — sign in again. No bags were marked. / La sesión terminó — inicie sesión de nuevo.');
      return;
    }
    const pinned = apiWithToken(auth.token);
    setMarking(true);
    const chosen = remainingIdx.filter(i => selected.has(i)).map(i => ({ i, f: needBag[i] }));
    const synced = chosen.filter(({ f }) => f.visitId);
    const queued = chosen.filter(({ f }) => !f.visitId && f.queueId);
    const unreachable = chosen.filter(({ f }) => !f.visitId && !f.queueId);
    // Settle per family: one failure must not block or misreport the others.
    const results = await Promise.allSettled([
      ...synced.map(({ f }) => pinned.patch(`/api/visits/${f.visitId}/bag`, { bag_received: true })),
      // Offline submissions: record the bag on the queued item — the flush
      // applies it to the visit after sync.
      ...queued.map(({ f }) => setItemBag(f.queueId!, true)),
    ]);
    const chosenOrdered = [...synced, ...queued];
    const failed: string[] = [];
    const recoveries: { i: number; f: SummaryFamily }[] = [];
    let alreadySynced = 0;
    let recordGone = 0;
    const newlySaved: number[] = [];
    let newlyPending = 0;
    results.forEach((r, k) => {
      if (r.status === 'fulfilled') {
        newlySaved.push(chosenOrdered[k].i);
        if (k >= synced.length) newlyPending++;
        return;
      }
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      const lower = msg.toLowerCase(); // API messages vary in case ('Not found')
      if (lower.includes('already synced')) {
        // Queue item synced mid-flow. Recover automatically: resolve the visit
        // by its idempotency key and PATCH the bag directly.
        recoveries.push(chosenOrdered[k]);
      } else if (lower.includes('not found')) {
        // The visit was removed server-side — a retry is permanently futile.
        recordGone++;
        newlySaved.push(chosenOrdered[k].i);
      } else {
        failed.push(`${chosenOrdered[k].f.name}: ${msg}`);
      }
    });
    // Second pass: recover bags whose queue items synced mid-flow
    for (const { i, f } of recoveries) {
      try {
        if (!f.visitKey) throw new Error('no key');
        const { id: visitId } = await pinned.get<{ id: string }>(`/api/visits/resolve/${encodeURIComponent(f.visitKey)}`);
        await pinned.patch(`/api/visits/${visitId}/bag`, { bag_received: true });
        newlySaved.push(i); // recovered — fully saved, no guidance needed
      } catch {
        // Couldn't recover automatically — fall back to the staff guidance
        alreadySynced++;
        newlySaved.push(i);
      }
    }
    setSavedIdx(prev => new Set([...prev, ...newlySaved]));
    setSavedPending(prev => prev + newlyPending);
    const problems: string[] = [];
    if (alreadySynced > 0) {
      problems.push(
        `${alreadySynced} family record(s) finished syncing just now — the check-in IS saved, but the bag must be marked by staff from View Records.`
      );
    }
    if (recordGone > 0) {
      problems.push(
        `${recordGone} visit record(s) no longer exist on the server — tell a supervisor before re-entering anything.`
      );
    }
    if (failed.length > 0) problems.push(`Failed: ${failed.join('; ')} — those families remain listed, check connection and retry.`);
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

      {remainingIdx.length > 0 && (
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
              {remainingIdx.map(i => { const f = needBag[i]; return (
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
              ); })}
              <button
                className="btn-secondary btn-large"
                style={{ marginTop: 8 }}
                onClick={handleSaveBags}
                disabled={marking || remainingIdx.filter(i => selected.has(i)).length === 0}
              >
                {marking
                  ? 'Saving... / Guardando...'
                  : `Save bags (${remainingIdx.filter(i => selected.has(i)).length}) / Guardar bolsas (${remainingIdx.filter(i => selected.has(i)).length})`}
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
