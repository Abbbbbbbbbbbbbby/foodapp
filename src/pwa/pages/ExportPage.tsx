import { useState } from 'react';
import { getToken } from '../store/auth';

interface FieldDef {
  key: string;
  label: string;
  group: 'family' | 'visit';
}

const FIELDS: FieldDef[] = [
  { key: 'name',                   label: 'Family Name',            group: 'family' },
  { key: 'phone',                  label: 'Phone',                  group: 'family' },
  { key: 'zip_code',               label: 'ZIP Code',               group: 'family' },
  { key: 'language',               label: 'Language',               group: 'family' },
  { key: 'num_people',             label: 'Household Size',         group: 'family' },
  { key: 'num_children_under_18',  label: 'Children Under 18',      group: 'family' },
  { key: 'num_children_under_5',   label: 'Children Under 5',       group: 'family' },
  { key: 'num_with_diabetes',      label: 'Members With Diabetes',  group: 'family' },
  { key: 'ami_bracket',            label: 'Income Level',           group: 'family' },
  { key: 'snap_benefits',          label: 'SNAP Benefits',          group: 'family' },
  { key: 'health_insurance',       label: 'Health Insurance',       group: 'family' },
  { key: 'hispanic',               label: 'Hispanic/Latino',        group: 'family' },
  { key: 'ethnicity',              label: 'Ethnicity',              group: 'family' },
  { key: 'receives_texts',         label: 'Receives Texts',         group: 'family' },
  { key: 'first_visit_date',       label: 'First Visit Date',       group: 'family' },
  { key: 'visit_date',             label: 'Visit Date',             group: 'visit'  },
  { key: 'bag_received',           label: 'Bag Received',           group: 'visit'  },
  { key: 'volunteer_name',         label: 'User',                   group: 'visit'  },
  { key: 'picked_up_by_phone',     label: 'Picked Up By (Phone)',   group: 'visit'  },
];

const FILTERABLE_FIELDS = [
  { key: 'language',              label: 'Language' },
  { key: 'zip_code',              label: 'ZIP Code' },
  { key: 'num_people',            label: 'Household Size' },
  { key: 'num_children_under_5',  label: 'Children Under 5' },
  { key: 'num_with_diabetes',     label: 'Members With Diabetes' },
  { key: 'ami_bracket',           label: 'Income Level' },
  { key: 'snap_benefits',         label: 'SNAP Benefits' },
  { key: 'health_insurance',      label: 'Health Insurance' },
  { key: 'hispanic',              label: 'Hispanic/Latino' },
  { key: 'ethnicity',             label: 'Ethnicity' },
];

// Fixed option sets for enum fields. zip_code has no fixed set and stays as free text.
const FIELD_OPTIONS: Record<string, { value: string; label: string }[]> = {
  language: [
    { value: 'en',       label: 'English' },
    { value: 'es',       label: 'Spanish' },
    { value: 'other',    label: 'Other' },
    { value: 'declined', label: 'N/A' },
  ],
  ami_bracket: [
    { value: '<30%',    label: 'Less than 30%' },
    { value: '30-50%',  label: '30–50%' },
    { value: '50-80%',  label: '50–80%' },
    { value: '80-120%', label: '80–120%' },
    { value: '>120%',   label: 'More than 120%' },
    { value: 'declined', label: 'N/A' },
  ],
  snap_benefits: [
    { value: 'yes',      label: 'Yes' },
    { value: 'no',       label: 'No' },
    { value: 'declined', label: 'N/A' },
  ],
  health_insurance: [
    { value: 'yes',      label: 'Yes' },
    { value: 'no',       label: 'No' },
    { value: 'declined', label: 'N/A' },
  ],
  hispanic: [
    { value: 'yes',      label: 'Yes' },
    { value: 'no',       label: 'No' },
    { value: 'declined', label: 'N/A' },
  ],
  ethnicity: [
    { value: 'American Indian or Alaska Native',              label: 'American Indian or Alaska Native' },
    { value: 'Asian',                                         label: 'Asian' },
    { value: 'Black or African American',                     label: 'Black or African American' },
    { value: 'Native Hawaiian or Other Pacific Islander',     label: 'Native Hawaiian or Other Pacific Islander' },
    { value: 'White',                                         label: 'White' },
    { value: 'Multiracial',                                   label: 'Multiracial' },
    { value: 'Other',                                         label: 'Other' },
    { value: 'Prefer not to say',                             label: 'Prefer not to say' },
  ],
};

type FilterMode = 'visit_date' | 'field' | 'multi';

interface MultiFilter {
  field: string;
  value: string;
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: 14,
};

// Every checkbox/radio label below needs an explicit flexDirection: 'row' —
// global.css's bare `label` rule defaults to column (correct for the
// Text-above-input pattern elsewhere), which would otherwise stack the
// control above its own text instead of beside it. See docs/design.md
// "Form Elements" for the full writeup.
const checkRowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'row', alignItems: 'center' };

const DEFAULT_FIELDS = new Set(['name', 'visit_date', 'bag_received', 'num_people']);

// Visually hidden — keeps the native input in the tab order and click area
// while the circle below provides the visual indicator.
const srOnly: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0,
  margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0,
};

function CircleDot({ checked }: { checked: boolean }) {
  return (
    <span style={{
      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
      border: `2px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
      background: checked ? 'var(--accent)' : 'transparent',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {checked && <span style={{ color: 'var(--text)', fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
    </span>
  );
}

export default function ExportPage() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(DEFAULT_FIELDS));
  const [filterMode, setFilterMode] = useState<FilterMode>('visit_date');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [filterField, setFilterField] = useState(FILTERABLE_FIELDS[0].key);
  const [filterValue, setFilterValue] = useState('');
  const [multiFilters, setMultiFilters] = useState<MultiFilter[]>([
    { field: FILTERABLE_FIELDS[0].key, value: '' },
  ]);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(group: 'family' | 'visit', on: boolean) {
    setSelected(prev => {
      const next = new Set(prev);
      FIELDS.filter(f => f.group === group).forEach(f => on ? next.add(f.key) : next.delete(f.key));
      return next;
    });
  }

  function addMultiFilter() {
    if (multiFilters.length >= 5) return;
    setMultiFilters(prev => [...prev, { field: FILTERABLE_FIELDS[0].key, value: '' }]);
  }

  function removeMultiFilter(i: number) {
    setMultiFilters(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateMultiFilter(i: number, patch: Partial<MultiFilter>) {
    setMultiFilters(prev => prev.map((f, idx) => idx === i ? { ...f, ...patch } : f));
  }

  async function doExport() {
    if (selected.size === 0) { setError('Select at least one field.'); return; }
    setError(null);
    setExporting(true);
    try {
      const params = new URLSearchParams();
      // Preserve the canonical field order from FIELDS
      params.set('fields', FIELDS.filter(f => selected.has(f.key)).map(f => f.key).join(','));
      params.set('filterMode', filterMode);
      if (filterMode === 'visit_date') {
        if (start) params.set('start', start);
        if (end)   params.set('end', end);
      } else if (filterMode === 'field') {
        params.set('filterField', filterField);
        params.set('filterValue', filterValue);
      } else {
        multiFilters.forEach(mf => {
          if (mf.value) {
            params.append('filterField', mf.field);
            params.append('filterValue', mf.value);
          }
        });
      }

      const token = getToken();
      const res = await fetch(`/api/admin/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? `Server error ${res.status}`);
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const familyFields = FIELDS.filter(f => f.group === 'family');
  const visitFields  = FIELDS.filter(f => f.group === 'visit');
  const allFamilyOn  = familyFields.every(f => selected.has(f.key));
  const allVisitOn   = visitFields.every(f => selected.has(f.key));

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 24 }}>Export Data</h1>

      {/* ── Field selection ── */}
      <section style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Fields to include</h2>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{selected.size} selected</span>
        </div>

        {/* Family fields */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '14px 16px', marginBottom: 10 }}>
          <label style={{ ...checkRowStyle, gap: 8, marginBottom: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" style={srOnly} checked={allFamilyOn} onChange={e => toggleGroup('family', e.target.checked)} />
            <CircleDot checked={allFamilyOn} />
            All family fields
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px 12px' }}>
            {familyFields.map(f => (
              <label key={f.key} style={{ ...checkRowStyle, gap: 7, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" style={srOnly} checked={selected.has(f.key)} onChange={() => toggle(f.key)} />
                <CircleDot checked={selected.has(f.key)} />
                {f.label}
              </label>
            ))}
          </div>
        </div>

        {/* Visit fields */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
          <label style={{ ...checkRowStyle, gap: 8, marginBottom: 10, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            <input type="checkbox" style={srOnly} checked={allVisitOn} onChange={e => toggleGroup('visit', e.target.checked)} />
            <CircleDot checked={allVisitOn} />
            All visit fields
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px 12px' }}>
            {visitFields.map(f => (
              <label key={f.key} style={{ ...checkRowStyle, gap: 7, fontSize: 14, cursor: 'pointer' }}>
                <input type="checkbox" style={srOnly} checked={selected.has(f.key)} onChange={() => toggle(f.key)} />
                <CircleDot checked={selected.has(f.key)} />
                {f.label}
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* ── Filter ── */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Filter records</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {([
            { value: 'visit_date', label: 'By visit date (default)' },
            { value: 'field',      label: 'By another field' },
            { value: 'multi',      label: 'By multiple fields' },
          ] as { value: FilterMode; label: string }[]).map(opt => (
            <label key={opt.value} style={{ ...checkRowStyle, gap: 8, fontSize: 14, cursor: 'pointer' }}>
              <input type="radio" style={srOnly} name="filterMode" value={opt.value} checked={filterMode === opt.value} onChange={() => setFilterMode(opt.value)} />
              <CircleDot checked={filterMode === opt.value} />
              {opt.label}
            </label>
          ))}
        </div>

        {filterMode === 'visit_date' && (
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
              <span style={{ color: 'var(--text-muted)' }}>Start date</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
              <span style={{ color: 'var(--text-muted)' }}>End date</span>
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} style={inputStyle} />
            </label>
            <p style={{ width: '100%', margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Leave both blank to export all visits.
            </p>
          </div>
        )}

        {filterMode === 'field' && (
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
              <span style={{ color: 'var(--text-muted)' }}>Field</span>
              <select value={filterField} onChange={e => { setFilterField(e.target.value); setFilterValue(''); }} style={inputStyle}>
                {FILTERABLE_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
              <span style={{ color: 'var(--text-muted)' }}>Value</span>
              {FIELD_OPTIONS[filterField] ? (
                <select value={filterValue} onChange={e => setFilterValue(e.target.value)} style={inputStyle}>
                  <option value="">Select…</option>
                  {FIELD_OPTIONS[filterField].map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  inputMode="numeric"
                  value={filterValue}
                  onChange={e => setFilterValue(e.target.value)}
                  placeholder={filterField === 'zip_code' ? 'e.g. 68102' : 'number'}
                  style={{ ...inputStyle, width: 120 }}
                />
              )}
            </label>
          </div>
        )}

        {filterMode === 'multi' && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {multiFilters.map((mf, i) => (
              <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                  {i === 0 && <span style={{ color: 'var(--text-muted)' }}>Field</span>}
                  <select
                    value={mf.field}
                    onChange={e => updateMultiFilter(i, { field: e.target.value, value: '' })}
                    style={inputStyle}
                  >
                    {FILTERABLE_FIELDS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14 }}>
                  {i === 0 && <span style={{ color: 'var(--text-muted)' }}>Value</span>}
                  {FIELD_OPTIONS[mf.field] ? (
                    <select
                      value={mf.value}
                      onChange={e => updateMultiFilter(i, { value: e.target.value })}
                      style={inputStyle}
                    >
                      <option value="">Select…</option>
                      {FIELD_OPTIONS[mf.field].map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={mf.value}
                      onChange={e => updateMultiFilter(i, { value: e.target.value })}
                      placeholder={mf.field === 'zip_code' ? 'e.g. 68102' : 'number'}
                      style={{ ...inputStyle, width: 120 }}
                    />
                  )}
                </label>
                {multiFilters.length > 1 && (
                  <button
                    className="btn-secondary"
                    onClick={() => removeMultiFilter(i)}
                    style={{ fontSize: 13 }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            {multiFilters.length < 5 && (
              <button
                className="btn-secondary"
                onClick={addMultiFilter}
                style={{ alignSelf: 'flex-start', fontSize: 13, marginTop: 4 }}
              >
                + Add filter
              </button>
            )}
          </div>
        )}
      </section>

      {error && (
        <p style={{ color: 'var(--error, #c0392b)', marginBottom: 16, fontSize: 14 }}>{error}</p>
      )}

      <button
        className="btn-primary"
        disabled={exporting || selected.size === 0}
        onClick={doExport}
        style={{ fontSize: 15, padding: '10px 24px' }}
      >
        {exporting ? 'Exporting…' : 'Export as CSV'}
      </button>
    </div>
  );
}
