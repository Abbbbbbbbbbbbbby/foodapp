import { useState } from 'react';
import { api } from '../../lib/api';

export interface SummaryFamily {
  id: string;
  name: string;
  num_people: number | null;
  bag_received: boolean | null;
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
  const [bagsMarked, setBagsMarked] = useState(false);
  const [marking, setMarking] = useState(false);
  const [bagError, setBagError] = useState<string | null>(null);

  const distCount = distributionCount(families);
  const hasLarge = families.some(f => (f.num_people ?? 0) > 5);
  const needBag = families.filter(f => !f.bag_received);
  const bagCount = bagsMarked ? 0 : needBag.length;

  async function handleMarkBags() {
    setBagError(null);
    setMarking(true);
    // Families without a persisted id (queue-only entries) cannot be PATCH'd yet
    const withId = needBag.filter(f => f.id !== '');
    const withoutId = needBag.filter(f => f.id === '');
    try {
      await Promise.all(
        withId.map(f => api.patch(`/api/families/${f.id}`, { bag_received: true }))
      );
      setBagsMarked(true);
      if (withoutId.length > 0) {
        // These families haven't synced yet so there is no server id to PATCH.
        // Bag status cannot be recorded for them until they sync and re-appear
        // in the system. Inform the volunteer plainly rather than promise a
        // background update that isn't wired up.
        setBagError(
          `${withoutId.length} family record(s) are still pending sync — bag status cannot be recorded until they upload. Note it manually for now.`
        );
      }
    } catch (err) {
      setBagError(
        err instanceof Error ? err.message : 'Failed to save — check your connection and try again.'
      );
    } finally {
      setMarking(false);
    }
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
          {bagsMarked && (
            <p style={{ fontSize: 11, color: 'var(--success)', marginTop: 2 }}>
              ✓ Recorded / Registradas
            </p>
          )}
        </div>
        <span style={{ ...bigNum, color: bagCount > 0 ? 'var(--accent)' : 'var(--success)' }}>
          {bagCount}
        </span>
      </div>

      {bagError && (
        <p style={{ marginTop: 8, fontSize: 13, color: 'var(--error, #c0392b)', padding: '8px 12px', background: 'var(--error-bg, #fdecea)', borderRadius: 6 }}>
          {bagError}
        </p>
      )}

      {bagCount > 0 && (
        <button
          className="btn-secondary btn-large"
          style={{ marginTop: 12 }}
          onClick={handleMarkBags}
          disabled={marking}
        >
          {marking
            ? 'Saving... / Guardando...'
            : `Bags given — mark ${bagCount} / Bolsas entregadas — marcar ${bagCount}`}
        </button>
      )}

      <button className="btn-primary btn-large" style={{ marginTop: 12 }} onClick={onNext}>
        Next car / Siguiente carro
      </button>
    </div>
  );
}
