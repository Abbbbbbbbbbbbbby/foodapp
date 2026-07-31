import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getUser } from '../store/auth';
import { localDateString, localMonthStart } from '../lib/date';

type Role = 'admin' | 'staff' | 'volunteer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VisitRecord {
  id: string;
  visit_date: string;
  bag_received: boolean;
  picked_up_by_phone: string | null;
  created_at: string;
  updated_at: string | null;
  updated_by: string | null;
  family_id: string;
  family_name: string;
  family_phone: string | null;
  num_people: number | null;
  volunteer_name: string | null;
  updated_by_name: string | null;
}

interface FamilyRecord {
  id: string;
  name: string;
  phone: string | null;
  num_people: number | null;
  first_visit_date: string | null;
  created_at: string;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
  hispanic: string | null;
  health_insurance: string | null;
  snap_benefits: string | null;
  ami_bracket: string | null;
  num_children_under_18: number | null;
  num_children_under_5: number | null;
  num_with_diabetes: number | null;
  receives_texts: boolean | null;
  want_text_updates: boolean | null;
  id_confirmed: boolean | null;
  address: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
  language: string | null;
  ethnicity: string | null;
  visit_count: number;
  last_visit_date: string | null;
}

interface ChangeEntry {
  id: string;
  changed_at: string;
  changed_by_name: string;
  changes: Record<string, { old: unknown; new: unknown }>;
}

type Timeframe = 'today' | 'month' | 'custom' | 'all';

// ── Helpers ───────────────────────────────────────────────────────────────────

function today(): string {
  return localDateString();
}

function monthStart(): string {
  return localMonthStart();
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return m + '/' + d + '/' + y;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fieldLabel(f: string): string {
  const labels: Record<string, string> = {
    visit_date: 'Visit date', bag_received: 'Bag received',
    volunteer_id: 'Volunteer', picked_up_by_phone: 'Pickup phone',
    num_people: 'Household size', name: 'Name', phone: 'Phone',
    address: 'Address', zip_code: 'ZIP', hispanic: 'Hispanic/Latino',
    health_insurance: 'Health insurance', snap_benefits: 'SNAP benefits',
    ami_bracket: 'AMI bracket', num_children_under_18: 'Children under 18',
    num_children_under_5: 'Children under 5', num_with_diabetes: 'Members w/ diabetes',
    receives_texts: 'Receives texts', want_text_updates: 'Wants text updates',
    id_confirmed: 'ID confirmed', first_visit_date: 'First visit date',
    _action: 'Action',
  };
  return labels[f] ?? f;
}

// ── Audit History ─────────────────────────────────────────────────────────────

function ChangeHistory({ table, recordId }: { table: string; recordId: string }) {
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null);

  useEffect(() => {
    api.get<{ changes: ChangeEntry[] }>(`/api/records/changes/${table}/${recordId}`)
      .then(d => setEntries(d.changes))
      .catch(() => setEntries([]));
  }, [table, recordId]);

  if (!entries) return <p className="records-muted">Loading history…</p>;
  if (entries.length === 0) return <p className="records-muted">No changes recorded.</p>;

  return (
    <div className="change-history">
      {entries.map(e => (
        <div key={e.id} className="change-entry">
          <div className="change-meta">
            {fmtDateTime(e.changed_at)} · {e.changed_by_name ?? 'Unknown'}
          </div>
          {Object.entries(e.changes).map(([f, v]) => (
            <div key={f} className="change-row">
              <span className="change-field">{fieldLabel(f)}</span>
              <span className="change-old">{String(v.old ?? '—')}</span>
              <span className="change-arrow">→</span>
              <span className="change-new">{String(v.new ?? '—')}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Delete Confirm (2 screens) ────────────────────────────────────────────────

interface DeleteConfirmProps {
  label: string;
  detail: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

function DeleteConfirm({ label, detail, onConfirm, onCancel }: DeleteConfirmProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);

  if (step === 1) {
    return (
      <div className="delete-confirm-box">
        <p className="delete-confirm-q">Delete {label}?</p>
        <p className="delete-confirm-detail">{detail}</p>
        <div className="delete-confirm-actions">
          <button className="btn-ghost delete-cancel-btn" onClick={onCancel}>Cancel</button>
          <button className="delete-next-btn" onClick={() => setStep(2)}>Continue</button>
        </div>
      </div>
    );
  }

  return (
    <div className="delete-confirm-box delete-confirm-final">
      <p className="delete-confirm-q">This cannot be undone.</p>
      <p className="delete-confirm-detail">
        All records for {label} will be permanently deleted, including visit history.
      </p>
      <div className="delete-confirm-actions">
        <button className="btn-ghost delete-cancel-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="delete-final-btn"
          disabled={busy}
          onClick={async () => { setBusy(true); await onConfirm(); }}
        >
          {busy ? 'Deleting…' : 'Yes, permanently delete'}
        </button>
      </div>
    </div>
  );
}

// ── Visit Card ─────────────────────────────────────────────────────────────────

interface VisitCardProps {
  visit: VisitRecord;
  role: Role;
  onUpdated: (id: string, patch: Partial<VisitRecord>) => void;
  onDeleted: (id: string) => void;
}

function VisitCard({ visit, role, onUpdated, onDeleted }: VisitCardProps) {
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState({ visit_date: visit.visit_date, bag_received: visit.bag_received });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      await api.patch(`/api/records/visits/${visit.id}`, draft);
      onUpdated(visit.id, draft);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  async function doDelete() {
    await api.delete(`/api/records/visits/${visit.id}`);
    onDeleted(visit.id);
  }

  return (
    <li className="records-card">
      <div className="records-card-top">
        <div className="records-card-main">
          <span className="records-family-name">{visit.family_name}</span>
          <span className="records-date">{fmtDate(visit.visit_date)}</span>
          {visit.num_people != null && (
            <span className="records-pill">{visit.num_people} people</span>
          )}
          {visit.bag_received && <span className="records-pill records-pill-green">Bag ✓</span>}
        </div>
        <div className="records-card-meta">
          {visit.volunteer_name && <span>{visit.volunteer_name}</span>}
          {visit.updated_by_name && (
            <span className="records-edited">Edited by {visit.updated_by_name}</span>
          )}
        </div>
      </div>

      {editing && (
        <div className="records-edit-form">
          <label className="records-field-label">
            Visit date
            <input
              type="date"
              value={draft.visit_date}
              onChange={e => setDraft(d => ({ ...d, visit_date: e.target.value }))}
            />
          </label>
          <label className="records-checkbox-label">
            <input
              type="checkbox"
              checked={draft.bag_received}
              onChange={e => setDraft(d => ({ ...d, bag_received: e.target.checked }))}
            />
            Bag received
          </label>
          {err && <p className="records-err">{err}</p>}
          <div className="records-edit-actions">
            <button className="records-save-btn" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-ghost" onClick={() => { setEditing(false); setErr(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleting && (
        <DeleteConfirm
          label={`${visit.family_name}'s visit on ${fmtDate(visit.visit_date)}`}
          detail="This visit record will be permanently removed."
          onConfirm={doDelete}
          onCancel={() => setDeleting(false)}
        />
      )}

      {showHistory && (
        <div className="records-history-wrap">
          <ChangeHistory table="visits" recordId={visit.id} />
        </div>
      )}

      <div className="records-card-footer">
        {!editing && !deleting && (
          <button className="records-action-btn" onClick={() => setEditing(true)}>Edit</button>
        )}
        {role === 'admin' && !editing && !deleting && (
          <>
            <button
              className="records-action-btn"
              onClick={() => setShowHistory(h => !h)}
            >
              {showHistory ? 'Hide history' : 'History'}
            </button>
            <button className="records-action-btn records-action-danger" onClick={() => setDeleting(true)}>
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// ── Visits Tab ─────────────────────────────────────────────────────────────────

interface VisitsTabProps { role: Role }

function VisitsTab({ role }: VisitsTabProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('month');
  const [customStart, setCustomStart] = useState(monthStart());
  const [customEnd, setCustomEnd] = useState(today());
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let start = '', end = '';
      if (timeframe === 'today') { start = today(); end = today(); }
      else if (timeframe === 'month') { start = monthStart(); end = today(); }
      else if (timeframe === 'custom') { start = customStart; end = customEnd; }
      const params = new URLSearchParams();
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      const qs = params.toString();
      const data = await api.get<{ visits: VisitRecord[] }>('/api/records/visits' + (qs ? '?' + qs : ''));
      setVisits(data.visits);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [timeframe, customStart, customEnd]);

  useEffect(() => { load(); }, [load]);

  function handleUpdated(id: string, patch: Partial<VisitRecord>) {
    setVisits(vs => vs.map(v => v.id === id ? { ...v, ...patch } : v));
  }
  function handleDeleted(id: string) {
    setVisits(vs => vs.filter(v => v.id !== id));
  }

  return (
    <div className="records-tab-content">
      <div className="timeframe-bar">
        {(['today', 'month', 'custom', 'all'] as Timeframe[]).map(tf => (
          <button
            key={tf}
            className={'timeframe-btn' + (timeframe === tf ? ' timeframe-btn-active' : '')}
            onClick={() => setTimeframe(tf)}
          >
            {tf === 'today' ? 'Today' : tf === 'month' ? 'This month' : tf === 'custom' ? 'Custom' : 'All time'}
          </button>
        ))}
      </div>

      {timeframe === 'custom' && (
        <div className="custom-range">
          <label className="records-field-label">
            From
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} />
          </label>
          <label className="records-field-label">
            To
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
          </label>
        </div>
      )}

      {error && <p className="records-error">{error}</p>}
      {loading && <p className="records-muted">Loading…</p>}
      {!loading && !error && visits.length === 0 && (
        <p className="records-muted">No visits found for this period.</p>
      )}

      <ul className="records-list">
        {visits.map(v => (
          <VisitCard
            key={v.id}
            visit={v}
            role={role}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
        ))}
      </ul>
    </div>
  );
}

// ── Family Card ────────────────────────────────────────────────────────────────

const YES_NO_DECLINED = ['yes', 'no', 'declined'];
const AMI_OPTIONS = ['<30%', '30-50%', '50-80%', '80-120%', '>120%', 'declined'];

interface FamilyCardProps {
  family: FamilyRecord;
  role: Role;
  onUpdated: (id: string, patch: Partial<FamilyRecord>) => void;
  onDeleted: (id: string) => void;
}

function FamilyCard({ family, role, onUpdated, onDeleted }: FamilyCardProps) {
  const [editing, setEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<Partial<FamilyRecord>>({ num_people: family.num_people });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    setDraft({
      num_people: family.num_people,
      ...(role === 'admin' ? {
        name: family.name,
        phone: family.phone ?? '',
        address: family.address ?? '',
        zip_code: family.zip_code ?? '',
        hispanic: family.hispanic ?? '',
        health_insurance: family.health_insurance ?? '',
        snap_benefits: family.snap_benefits ?? '',
        ami_bracket: family.ami_bracket ?? '',
        num_children_under_18: family.num_children_under_18,
        num_children_under_5: family.num_children_under_5,
        num_with_diabetes: family.num_with_diabetes,
      } : {}),
    });
    setEditing(true);
  }

  async function save() {
    if (draft.name !== undefined && !draft.name) {
      setErr('Name cannot be empty');
      return;
    }
    setSaving(true); setErr(null);
    const ENUM_FIELDS = new Set(['hispanic', 'health_insurance', 'snap_benefits', 'ami_bracket']);
    const NUM_FIELDS = new Set(['num_people', 'num_children_under_18', 'num_children_under_5', 'num_with_diabetes']);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v === undefined) continue;
      if (v === '' && ENUM_FIELDS.has(k)) { patch[k] = null; continue; }
      if (v === '' && NUM_FIELDS.has(k)) { patch[k] = null; continue; }
      if (v !== null) patch[k] = v;
      else patch[k] = null; // explicit null clears the field
    }
    try {
      await api.patch(`/api/records/families/${family.id}`, patch);
      onUpdated(family.id, draft);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }

  async function doDelete() {
    await api.delete(`/api/records/families/${family.id}`);
    onDeleted(family.id);
  }

  function setField(f: string, val: unknown) {
    setDraft(d => ({ ...d, [f]: val }));
  }

  return (
    <li className="records-card">
      <div className="records-card-top">
        <div className="records-card-main">
          <span className="records-family-name">{family.name}</span>
          {family.phone && <span className="records-date">{family.phone}</span>}
          {family.num_people != null && (
            <span className="records-pill">{family.num_people} people</span>
          )}
        </div>
        <div className="records-card-meta">
          <span>{family.visit_count} visit{family.visit_count !== 1 ? 's' : ''}</span>
          {family.last_visit_date && <span>Last: {fmtDate(family.last_visit_date)}</span>}
          {family.updated_by_name && (
            <span className="records-edited">Edited by {family.updated_by_name}</span>
          )}
        </div>
      </div>

      {editing && (
        <div className="records-edit-form">
          <label className="records-field-label">
            Household size
            <input
              type="number"
              min={1}
              value={draft.num_people ?? ''}
              onChange={e => setField('num_people', e.target.value ? Number(e.target.value) : null)}
            />
          </label>
          {role === 'admin' && (
            <>
              <label className="records-field-label">
                Name
                <input type="text" value={String(draft.name ?? '')} onChange={e => setField('name', e.target.value)} />
              </label>
              <label className="records-field-label">
                Phone
                <input type="tel" value={String(draft.phone ?? '')} onChange={e => setField('phone', e.target.value)} />
              </label>
              <label className="records-field-label">
                Address
                <input type="text" value={String(draft.address ?? '')} onChange={e => setField('address', e.target.value)} />
              </label>
              <label className="records-field-label">
                ZIP
                <input type="text" value={String(draft.zip_code ?? '')} onChange={e => setField('zip_code', e.target.value)} />
              </label>
              <label className="records-field-label">
                Hispanic/Latino
                <select value={String(draft.hispanic ?? '')} onChange={e => setField('hispanic', e.target.value)}>
                  <option value="">—</option>
                  {YES_NO_DECLINED.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="records-field-label">
                Health insurance
                <select value={String(draft.health_insurance ?? '')} onChange={e => setField('health_insurance', e.target.value)}>
                  <option value="">—</option>
                  {YES_NO_DECLINED.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="records-field-label">
                SNAP benefits
                <select value={String(draft.snap_benefits ?? '')} onChange={e => setField('snap_benefits', e.target.value)}>
                  <option value="">—</option>
                  {YES_NO_DECLINED.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="records-field-label">
                AMI bracket
                <select value={String(draft.ami_bracket ?? '')} onChange={e => setField('ami_bracket', e.target.value)}>
                  <option value="">—</option>
                  {AMI_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="records-field-label">
                Children under 18
                <input type="number" min={0} value={draft.num_children_under_18 ?? ''} onChange={e => setField('num_children_under_18', e.target.value ? Number(e.target.value) : null)} />
              </label>
              <label className="records-field-label">
                Children under 5
                <input type="number" min={0} value={draft.num_children_under_5 ?? ''} onChange={e => setField('num_children_under_5', e.target.value ? Number(e.target.value) : null)} />
              </label>
              <label className="records-field-label">
                Members with diabetes
                <input type="number" min={0} value={draft.num_with_diabetes ?? ''} onChange={e => setField('num_with_diabetes', e.target.value ? Number(e.target.value) : null)} />
              </label>
            </>
          )}
          {err && <p className="records-err">{err}</p>}
          <div className="records-edit-actions">
            <button className="records-save-btn" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-ghost" onClick={() => { setEditing(false); setErr(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleting && (
        <DeleteConfirm
          label={family.name}
          detail={`This will permanently delete ${family.name} and all ${family.visit_count} associated visit record${family.visit_count !== 1 ? 's' : ''}.`}
          onConfirm={doDelete}
          onCancel={() => setDeleting(false)}
        />
      )}

      {showHistory && (
        <div className="records-history-wrap">
          <ChangeHistory table="families" recordId={family.id} />
        </div>
      )}

      <div className="records-card-footer">
        {!editing && !deleting && (
          <button className="records-action-btn" onClick={startEdit}>Edit</button>
        )}
        {role === 'admin' && !editing && !deleting && (
          <>
            <button
              className="records-action-btn"
              onClick={() => setShowHistory(h => !h)}
            >
              {showHistory ? 'Hide history' : 'History'}
            </button>
            <button className="records-action-btn records-action-danger" onClick={() => setDeleting(true)}>
              Delete
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// ── Families Tab ───────────────────────────────────────────────────────────────

interface FamiliesTabProps { role: Role }

function FamiliesTab({ role }: FamiliesTabProps) {
  const [q, setQ] = useState('');
  const [families, setFamilies] = useState<FamilyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const seqRef = useRef(0);

  const load = useCallback(async (search: string) => {
    const seq = ++seqRef.current;
    setLoading(true); setError(null);
    try {
      const qs = search ? '?q=' + encodeURIComponent(search) : '';
      const data = await api.get<{ families: FamilyRecord[] }>('/api/records/families' + qs);
      if (seq !== seqRef.current) return;
      setFamilies(data.families);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { if (seq === seqRef.current) setLoading(false); }
  }, []);

  useEffect(() => { load(''); }, [load]);

  function handleUpdated(id: string, patch: Partial<FamilyRecord>) {
    setFamilies(fs => fs.map(f => f.id === id ? { ...f, ...patch } : f));
  }
  function handleDeleted(id: string) {
    setFamilies(fs => fs.filter(f => f.id !== id));
  }

  function handleSearch(val: string) {
    setQ(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => load(val), 300);
  }

  return (
    <div className="records-tab-content">
      <div className="records-search-wrap">
        <input
          type="text"
          className="records-search"
          placeholder="Search by name or phone"
          value={q}
          onChange={e => handleSearch(e.target.value)}
        />
      </div>

      {error && <p className="records-error">{error}</p>}
      {loading && <p className="records-muted">Loading…</p>}
      {!loading && !error && families.length === 0 && (
        <p className="records-muted">{q ? 'No families match "' + q + '"' : 'No families found.'}</p>
      )}

      <ul className="records-list">
        {families.map(f => (
          <FamilyCard
            key={f.id}
            family={f}
            role={role}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
        ))}
      </ul>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function RecordsPage() {
  const navigate = useNavigate();
  const user = getUser()!;
  const [tab, setTab] = useState<'visits' | 'families'>('visits');

  return (
    <div className="records-page">
      <div className="records-header">
        <button className="btn-ghost records-back" onClick={() => navigate('/')}>← Back</button>
        <h1 className="records-title">Records</h1>
      </div>

      <div className="records-tabs">
        <button
          className={'records-tab-btn' + (tab === 'visits' ? ' records-tab-active' : '')}
          onClick={() => setTab('visits')}
        >
          Visits
        </button>
        <button
          className={'records-tab-btn' + (tab === 'families' ? ' records-tab-active' : '')}
          onClick={() => setTab('families')}
        >
          Families
        </button>
      </div>

      {tab === 'visits' ? (
        <VisitsTab role={user.role} />
      ) : (
        <FamiliesTab role={user.role} />
      )}
    </div>
  );
}
