import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

// ── Types ────────────────────────────────────────────────────────────────────

type Bucket = { value: string; count: number };
type SummaryData = {
  totals: { families: number; visits: number; boxes: number; bags: number };
  fields: Record<string, Bucket[]>;
};
type FilterResult = { count: number; total: number };

type CatFilter = { type: 'cat'; field: string; values: string[] };
type NumFilter = { type: 'num'; field: string; op: string; val: string };
type Filter = CatFilter | NumFilter;

// ── Constants ─────────────────────────────────────────────────────────────────

const NUMERIC_FIELDS = new Set(['num_people', 'num_children_under_18', 'num_children_under_5', 'num_with_diabetes']);

const FILTER_FIELDS: { key: string; label: string; type: 'cat' | 'num' }[] = [
  { key: 'language',             label: 'Language',             type: 'cat' },
  { key: 'zip_code',             label: 'ZIP Code',             type: 'cat' },
  { key: 'ami_bracket',          label: 'Income Level',         type: 'cat' },
  { key: 'snap_benefits',        label: 'SNAP Benefits',        type: 'cat' },
  { key: 'health_insurance',     label: 'Health Insurance',     type: 'cat' },
  { key: 'hispanic',             label: 'Hispanic/Latino',      type: 'cat' },
  { key: 'ethnicity',            label: 'Ethnicity',            type: 'cat' },
  { key: 'receives_texts',       label: 'Receives Texts',       type: 'cat' },
  { key: 'bag_received',         label: 'Bag Received',         type: 'cat' },
  { key: 'num_people',           label: 'Household Size',       type: 'num' },
  { key: 'num_children_under_18',label: 'Children Under 18',   type: 'num' },
  { key: 'num_children_under_5', label: 'Children Under 5',    type: 'num' },
  { key: 'num_with_diabetes',    label: 'Members w/ Diabetes',  type: 'num' },
];

const CHART_DEFS: { key: string; label: string; numeric?: boolean; note?: string }[] = [
  { key: 'language',              label: 'Language' },
  { key: 'zip_code',              label: 'ZIP Code', note: 'Top 20' },
  { key: 'ami_bracket',           label: 'Income Level' },
  { key: 'snap_benefits',         label: 'SNAP Benefits' },
  { key: 'health_insurance',      label: 'Health Insurance' },
  { key: 'hispanic',              label: 'Hispanic / Latino' },
  { key: 'ethnicity',             label: 'Ethnicity', note: 'Top 20' },
  { key: 'receives_texts',        label: 'Receives Texts' },
  { key: 'bag_received',          label: 'Bag Received' },
  { key: 'num_people',            label: 'Household Size',       numeric: true },
  { key: 'num_children_under_18', label: 'Children Under 18',    numeric: true },
  { key: 'num_children_under_5',  label: 'Children Under 5',     numeric: true },
  { key: 'num_with_diabetes',     label: 'Members w/ Diabetes',  numeric: true },
];

// Human-readable labels for coded values
const VALUE_LABELS: Record<string, Record<string, string>> = {
  snap_benefits:   { yes: 'Yes', no: 'No', declined: 'Prefer not to say' },
  health_insurance:{ yes: 'Yes', no: 'No', declined: 'Prefer not to say' },
  hispanic:        { yes: 'Yes', no: 'No', declined: 'Prefer not to say' },
  receives_texts:  { '1': 'Yes', '0': 'No' },
  bag_received:    { '1': 'Received', '0': 'Not received' },
};

function displayValue(field: string, value: string): string {
  return VALUE_LABELS[field]?.[value] ?? value;
}

// ── Date range helpers ────────────────────────────────────────────────────────

type Preset = 'all' | 'month' | '3months' | 'year' | 'custom';

function presetDates(preset: Preset): { start: string; end: string } {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  if (preset === 'month') {
    const d = new Date(today); d.setMonth(d.getMonth() - 1);
    return { start: d.toISOString().slice(0, 10), end };
  }
  if (preset === '3months') {
    const d = new Date(today); d.setMonth(d.getMonth() - 3);
    return { start: d.toISOString().slice(0, 10), end };
  }
  if (preset === 'year') {
    const d = new Date(today); d.setFullYear(d.getFullYear() - 1);
    return { start: d.toISOString().slice(0, 10), end };
  }
  return { start: '', end: '' };
}

// ── BarChart component ────────────────────────────────────────────────────────

function BarChart({ data, baseTotal, field, numeric }: {
  data: Bucket[];
  baseTotal: number;
  field: string;
  numeric?: boolean;
}) {
  const sorted = numeric
    ? [...data].sort((a, b) => Number(a.value) - Number(b.value))
    : data;
  const max = Math.max(...sorted.map(b => b.count), 1);
  const answered = sorted.reduce((sum, b) => sum + b.count, 0);
  const notAnswered = Math.max(0, baseTotal - answered);

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 6,
  };
  const labelStyle: React.CSSProperties = {
    width: 120,
    flexShrink: 0,
    fontSize: 13,
    color: 'var(--text)',
    paddingRight: 8,
    textAlign: 'right',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
  const trackStyle: React.CSSProperties = {
    flex: 1,
    height: 20,
    background: 'var(--surface-2)',
    borderRadius: 4,
    overflow: 'hidden',
  };
  const countStyle: React.CSSProperties = {
    width: 90,
    flexShrink: 0,
    paddingLeft: 8,
    fontSize: 12,
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
  };

  if (sorted.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No data</p>;
  }

  return (
    <div>
      {sorted.map(b => (
        <div key={b.value} style={row}>
          <span style={labelStyle} title={displayValue(field, b.value)}>
            {displayValue(field, b.value)}
          </span>
          <div style={trackStyle}>
            <div style={{
              width: `${(b.count / max) * 100}%`,
              height: '100%',
              background: 'var(--accent)',
            }} />
          </div>
          <span style={countStyle}>
            {b.count.toLocaleString()}
            {baseTotal > 0 ? ` (${Math.round((b.count / baseTotal) * 100)}%)` : ''}
          </span>
        </div>
      ))}
      {notAnswered > 0 && (
        <div style={{ ...row, marginTop: 4, opacity: 0.55 }}>
          <span style={{ ...labelStyle, fontSize: 12, color: 'var(--text-muted)' }}>Not answered</span>
          <div style={{ ...trackStyle, height: 14 }}>
            <div style={{
              width: `${(notAnswered / max) * 100}%`,
              height: '100%',
              background: 'var(--border)',
            }} />
          </div>
          <span style={{ ...countStyle, color: 'var(--text-muted)' }}>
            {notAnswered.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Totals banner ─────────────────────────────────────────────────────────────

function TotalCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '14px 16px',
      textAlign: 'center',
      flex: 1,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent-text)', lineHeight: 1 }}>
        {value === null ? '—' : value.toLocaleString()}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DataSummaryPage() {
  const [preset, setPreset]           = useState<Preset>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd]     = useState('');
  const [summary, setSummary]         = useState<SummaryData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  const [filters, setFilters]         = useState<Filter[]>([]);
  const [logic, setLogic]             = useState<'and' | 'or'>('and');
  const [filterResult, setFilterResult] = useState<FilterResult | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);

  // Resolved date range for the current preset
  function resolvedRange(): { start: string; end: string } {
    if (preset === 'custom') return { start: customStart, end: customEnd };
    return presetDates(preset);
  }

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSummary(null);
    setFilterResult(null);
    try {
      const { start, end } = resolvedRange();
      const qs = start && end ? `?start=${start}&end=${end}` : '';
      const data = await api.get<SummaryData>(`/api/admin/summary${qs}`);
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load summary');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customStart, customEnd]);

  useEffect(() => {
    if (preset === 'custom' && (!customStart || !customEnd)) return;
    void loadSummary();
  }, [loadSummary, preset, customStart, customEnd]);

  async function applyFilter() {
    if (filters.length === 0) return;
    setFilterLoading(true);
    setFilterError(null);
    try {
      const params = new URLSearchParams();
      const { start, end } = resolvedRange();
      if (start && end) { params.set('start', start); params.set('end', end); }
      params.set('logic', logic);
      for (const f of filters) {
        if (f.type === 'cat') {
          if (f.values.length === 0) continue;
          for (const v of f.values) {
            params.append('field', f.field);
            params.append('op', 'eq');
            params.append('val', v);
          }
        } else {
          if (!f.val) continue;
          params.append('field', f.field);
          params.append('op', f.op);
          params.append('val', f.val);
        }
      }
      const result = await api.get<FilterResult>(`/api/admin/summary?${params.toString()}`);
      setFilterResult(result);
    } catch (e) {
      setFilterError(e instanceof Error ? e.message : 'Filter failed');
    } finally {
      setFilterLoading(false);
    }
  }

  function addFilter(field: string) {
    const def = FILTER_FIELDS.find(f => f.key === field);
    if (!def) return;
    if (def.type === 'cat') {
      setFilters(prev => [...prev, { type: 'cat', field, values: [] }]);
    } else {
      setFilters(prev => [...prev, { type: 'num', field, op: 'gte', val: '' }]);
    }
  }

  function removeFilter(i: number) {
    setFilters(prev => prev.filter((_, idx) => idx !== i));
    setFilterResult(null);
  }

  function updateCatValues(i: number, value: string) {
    setFilters(prev => prev.map((f, idx) => {
      if (idx !== i || f.type !== 'cat') return f;
      const values = f.values.includes(value)
        ? f.values.filter(v => v !== value)
        : [...f.values, value];
      return { ...f, values };
    }));
    setFilterResult(null);
  }

  function updateNumFilter(i: number, field: 'op' | 'val', value: string) {
    setFilters(prev => prev.map((f, idx) =>
      idx === i && f.type === 'num' ? { ...f, [field]: value } : f
    ));
    setFilterResult(null);
  }

  const card: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '16px',
  };

  const presetBtn = (p: Preset, label: string) => (
    <button
      type="button"
      onClick={() => { setPreset(p); setFilterResult(null); }}
      style={{
        padding: '8px 14px',
        fontSize: 13,
        fontWeight: preset === p ? 700 : 400,
        background: preset === p ? 'var(--accent)' : 'var(--surface)',
        color: preset === p ? 'var(--text)' : 'var(--text-muted)',
        border: `1px solid ${preset === p ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 6,
        cursor: 'pointer',
        marginRight: 6,
        marginBottom: 6,
      }}
    >
      {label}
    </button>
  );

  // Build option list for a categorical filter row from the summary data
  function catOptions(field: string): string[] {
    if (!summary) return [];
    const buckets = summary.fields[field] ?? [];
    return buckets.map(b => b.value);
  }

  const totals = summary?.totals;

  return (
    <div style={{ padding: '0 0 40px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Data Summary</h1>

      {/* ── Date range ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Period</p>
        <div>
          {presetBtn('all',      'All time')}
          {presetBtn('month',    'Past month')}
          {presetBtn('3months',  'Past 3 months')}
          {presetBtn('year',     'Past year')}
          {presetBtn('custom',   'Custom')}
        </div>
        {preset === 'custom' && (
          <div style={{ display: 'flex', marginTop: 10 }}>
            <div style={{ marginRight: 12 }}>
              <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>From</label>
              <input
                type="date"
                value={customStart}
                onChange={e => { setCustomStart(e.target.value); setFilterResult(null); }}
                style={{ fontSize: 14, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>To</label>
              <input
                type="date"
                value={customEnd}
                onChange={e => { setCustomEnd(e.target.value); setFilterResult(null); }}
                style={{ fontSize: 14, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Totals banner ── */}
      <div style={{ display: 'flex', marginBottom: 16 }}>
        <TotalCard label="Families served"  value={totals?.families ?? null} />
        <div style={{ width: 8, flexShrink: 0 }} />
        <TotalCard label="Total visits"     value={totals?.visits ?? null} />
        <div style={{ width: 8, flexShrink: 0 }} />
        <TotalCard label="Boxes distributed" value={totals?.boxes ?? null} />
        <div style={{ width: 8, flexShrink: 0 }} />
        <TotalCard label="Bags recorded"    value={totals?.bags ?? null} />
      </div>

      {/* ── Cross-filter builder ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>Filter families</p>
          {filters.length > 1 && (
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
              {(['and', 'or'] as const).map(l => (
                <button
                  key={l}
                  type="button"
                  onClick={() => { setLogic(l); setFilterResult(null); }}
                  style={{
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: logic === l ? 700 : 400,
                    background: logic === l ? 'var(--accent-text)' : 'var(--surface)',
                    color: logic === l ? '#fff' : 'var(--text-muted)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>

        {filters.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
            Add filters to count families matching specific criteria.
          </p>
        )}

        {filters.map((f, i) => {
          const def = FILTER_FIELDS.find(d => d.key === f.field)!;
          const opts = catOptions(f.field);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 10, background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{def.label}</p>
                {f.type === 'cat' ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                    {opts.map(opt => {
                      const selected = f.values.includes(opt);
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => updateCatValues(i, opt)}
                          style={{
                            padding: '4px 10px',
                            fontSize: 13,
                            background: selected ? 'var(--accent)' : 'var(--surface)',
                            color: 'var(--text)',
                            border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                            borderRadius: 20,
                            cursor: 'pointer',
                            marginRight: 6,
                            marginBottom: 6,
                            fontWeight: selected ? 700 : 400,
                          }}
                        >
                          {displayValue(f.field, opt)}
                        </button>
                      );
                    })}
                    {opts.length === 0 && (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading options…</span>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <select
                      value={(f as NumFilter).op}
                      onChange={e => updateNumFilter(i, 'op', e.target.value)}
                      style={{ fontSize: 13, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, marginRight: 8, background: 'var(--surface)' }}
                    >
                      <option value="eq">= (exactly)</option>
                      <option value="gte">≥ (at least)</option>
                      <option value="lte">≤ (at most)</option>
                      <option value="gt">&gt; (more than)</option>
                      <option value="lt">&lt; (fewer than)</option>
                    </select>
                    <input
                      type="number"
                      min="0"
                      value={(f as NumFilter).val}
                      onChange={e => updateNumFilter(i, 'val', e.target.value)}
                      style={{ width: 80, fontSize: 13, padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6 }}
                    />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeFilter(i)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-muted)', marginLeft: 8, padding: '0 4px', lineHeight: 1 }}
                aria-label="Remove filter"
              >×</button>
            </div>
          );
        })}

        <div style={{ display: 'flex', alignItems: 'center', marginTop: filters.length > 0 ? 4 : 0 }}>
          <div style={{ flex: 1 }}>
            <select
              value=""
              onChange={e => { if (e.target.value) addFilter(e.target.value); }}
              style={{ fontSize: 13, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface)', color: 'var(--text-muted)' }}
            >
              <option value="">+ Add filter…</option>
              {FILTER_FIELDS.map(d => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          </div>
          {filters.length > 0 && (
            <button
              type="button"
              className="btn-primary"
              onClick={applyFilter}
              disabled={filterLoading}
              style={{ marginLeft: 10 }}
            >
              {filterLoading ? 'Applying…' : 'Apply'}
            </button>
          )}
        </div>

        {filterError && (
          <p style={{ marginTop: 8, fontSize: 13, color: 'var(--danger)' }}>{filterError}</p>
        )}
        {filterResult && (
          <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--accent)', borderRadius: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {filterResult.count.toLocaleString()}
            </span>
            <span style={{ fontSize: 14, color: 'var(--text)' }}>
              {' '}of {filterResult.total.toLocaleString()} families match
            </span>
            {filterResult.total > 0 && (
              <span style={{ fontSize: 13, color: 'var(--text)', marginLeft: 6 }}>
                ({Math.round((filterResult.count / filterResult.total) * 100)}%)
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Charts ── */}
      {error && (
        <p style={{ color: 'var(--danger)', fontSize: 14, marginBottom: 12 }}>{error}</p>
      )}
      {loading && (
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</p>
      )}
      {summary && (
        <div className="summary-chart-grid">
          {CHART_DEFS.map(def => {
            const data = summary.fields[def.key] ?? [];
            return (
              <div key={def.key} className="summary-chart-card">
                <div style={card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{def.label}</p>
                    {def.note && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{def.note}</span>
                    )}
                  </div>
                  <BarChart
                    data={data}
                    baseTotal={summary.totals.families}
                    field={def.key}
                    numeric={def.numeric}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
