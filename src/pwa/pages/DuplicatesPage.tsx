import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

interface FamilySummary {
  id: string;
  name: string;
  phone: string | null;
  num_people: number | null;
  language: string | null;
  visit_count: number;
  last_visit_date: string | null;
}

interface DuplicateFlag {
  id: string;
  reason: 'phone' | 'name_exact' | 'name_fuzzy';
  created_at: string;
  family_a: FamilySummary;
  family_b: FamilySummary;
}

const REASON_LABEL: Record<DuplicateFlag['reason'], string> = {
  phone: 'Same phone',
  name_exact: 'Same name',
  name_fuzzy: 'Similar name',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}

function phoneDisplay(p: string | null): string {
  if (!p) return 'No phone';
  if (p.length === 10) return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
  return p;
}

// Returns the family with the more recent last visit (or more visits as tiebreaker)
function defaultKeep(a: FamilySummary, b: FamilySummary): string {
  if (a.last_visit_date && b.last_visit_date) {
    if (a.last_visit_date > b.last_visit_date) return a.id;
    if (b.last_visit_date > a.last_visit_date) return b.id;
  }
  if (a.last_visit_date && !b.last_visit_date) return a.id;
  if (b.last_visit_date && !a.last_visit_date) return b.id;
  return a.visit_count >= b.visit_count ? a.id : b.id;
}

function FamilyCard({
  family,
  selected,
  onSelect,
  showRadio,
}: {
  family: FamilySummary;
  selected: boolean;
  onSelect?: () => void;
  showRadio: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        border: selected && showRadio ? '2px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        cursor: showRadio ? 'pointer' : 'default',
        background: selected && showRadio ? 'var(--surface-raised, var(--surface))' : 'var(--surface)',
      }}
      onClick={onSelect}
    >
      {showRadio && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <input type="radio" readOnly checked={selected} style={{ cursor: 'pointer' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
            {selected ? 'Keep this record' : 'Keep this record'}
          </span>
        </div>
      )}
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{family.name}</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 2 }}>
        {phoneDisplay(family.phone)}
      </div>
      {family.num_people !== null && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 2 }}>
          {family.num_people} {family.num_people === 1 ? 'person' : 'people'}
        </div>
      )}
      {family.language && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 2 }}>
          {family.language}
        </div>
      )}
      <div style={{ fontSize: 13, marginTop: 6 }}>
        <span style={{ color: 'var(--text-muted)' }}>
          {family.visit_count} {family.visit_count === 1 ? 'visit' : 'visits'}
        </span>
        {family.last_visit_date && (
          <span style={{ color: 'var(--text-muted)' }}>
            {' · '}Last: {fmtDate(family.last_visit_date)}
          </span>
        )}
      </div>
    </div>
  );
}

function FlagCard({
  flag,
  onMerged,
  onDismissed,
}: {
  flag: DuplicateFlag;
  onMerged: (id: string) => void;
  onDismissed: (id: string) => void;
}) {
  const [merging, setMerging] = useState(false);
  const [keepId, setKeepId] = useState(() => defaultKeep(flag.family_a, flag.family_b));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmMerge() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/duplicates/${flag.id}/merge`, { keep_id: keepId });
      onMerged(flag.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to merge');
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/admin/duplicates/${flag.id}/dismiss`, {});
      onDismissed(flag.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to dismiss');
      setBusy(false);
    }
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '16px',
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
          textTransform: 'uppercase', background: 'var(--accent)',
          color: '#000', padding: '2px 8px', borderRadius: 4,
        }}>
          {REASON_LABEL[flag.reason]}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Flagged {fmtDate(flag.created_at)}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <FamilyCard
          family={flag.family_a}
          selected={keepId === flag.family_a.id}
          onSelect={merging ? () => setKeepId(flag.family_a.id) : undefined}
          showRadio={merging}
        />
        <FamilyCard
          family={flag.family_b}
          selected={keepId === flag.family_b.id}
          onSelect={merging ? () => setKeepId(flag.family_b.id) : undefined}
          showRadio={merging}
        />
      </div>

      {error && (
        <p style={{ color: 'var(--error, #e53)', fontSize: 13, marginTop: 10 }}>{error}</p>
      )}

      {!merging ? (
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => setMerging(true)}
          >
            Merge
          </button>
          <button
            className="btn-ghost"
            disabled={busy}
            onClick={dismiss}
          >
            {busy ? 'Saving…' : 'Mark as Different'}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
            Select which record to keep. Visit history from both will be combined.
            Blank fields on the kept record will be filled from the other. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={confirmMerge}
            >
              {busy ? 'Merging…' : 'Confirm Merge'}
            </button>
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => { setMerging(false); setError(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DuplicatesPage() {
  const navigate = useNavigate();
  const [flags, setFlags] = useState<DuplicateFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ flags: DuplicateFlag[] }>('/api/admin/duplicates')
      .then(data => setFlags(data.flags))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  function onMerged(id: string) {
    setFlags(fs => fs.filter(f => f.id !== id));
  }

  function onDismissed(id: string) {
    setFlags(fs => fs.filter(f => f.id !== id));
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 16px 40px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: '20px 0 16px' }}>
        <button className="btn-ghost" onClick={() => navigate('/')}>← Back</button>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Duplicate Families</h1>
        {!loading && (
          <span style={{ fontSize: 14, color: 'var(--text-muted)', marginLeft: 4 }}>
            {flags.length} pending
          </span>
        )}
      </div>

      {error && <p style={{ color: 'var(--error, #e53)' }}>{error}</p>}
      {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}

      {!loading && flags.length === 0 && !error && (
        <p style={{ color: 'var(--text-muted)', marginTop: 24 }}>
          No duplicate families found.
        </p>
      )}

      {flags.map(flag => (
        <FlagCard
          key={flag.id}
          flag={flag}
          onMerged={onMerged}
          onDismissed={onDismissed}
        />
      ))}
    </div>
  );
}
