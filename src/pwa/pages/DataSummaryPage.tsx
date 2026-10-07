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
  { key: 'num_with_diabetes',    label: 'Members with Diabetes',  type: 'num' },
];

type ChartDef = { key: string; label: string; numeric?: boolean; note?: string };
type ChartSection = { label: string; color: string; charts: ChartDef[] };

const CHART_SECTIONS: ChartSection[] = [
  {
    label: 'Household', color: '#234090',
    charts: [
      { key: 'num_people',            label: 'Household Size',      numeric: true },
      { key: 'num_children_under_18', label: 'Children Under 18',   numeric: true },
      { key: 'num_children_under_5',  label: 'Children Under 5',    numeric: true },
      { key: 'num_with_diabetes',     label: 'Members with Diabetes', numeric: true },
    ],
  },
  {
    label: 'Demographics', color: '#8a2e1e',
    charts: [
      { key: 'language',   label: 'Language' },
      { key: 'zip_code',   label: 'ZIP Code',    note: 'Top 10 + others' },
      { key: 'ami_bracket', label: 'Income Level' },
      { key: 'hispanic',   label: 'Hispanic / Latino' },
      { key: 'ethnicity',  label: 'Ethnicity',   note: 'Top 20' },
    ],
  },
  {
    label: 'Benefits & Services', color: '#cc8f00',
    charts: [
      { key: 'snap_benefits',    label: 'SNAP Benefits' },
      { key: 'health_insurance', label: 'Health Insurance' },
      { key: 'bag_received',     label: 'Bag Received' },
      { key: 'receives_texts',   label: 'Receives Texts' },
    ],
  },
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

type Preset = 'all' | 'lastmonth' | 'month' | '3months' | 'year' | 'custom';

function presetDates(preset: Preset): { start: string; end: string } {
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  if (preset === 'lastmonth') {
    // First and last day of the most recently completed calendar month
    const y = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
    const m = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
    const first = new Date(y, m, 1).toISOString().slice(0, 10);
    const last  = new Date(y, m + 1, 0).toISOString().slice(0, 10);
    return { start: first, end: last };
  }
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

// Name of the most recently completed calendar month (e.g. "August 2026")
function lastMonthLabel(): string {
  const today = new Date();
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// ── Shared tooltip ────────────────────────────────────────────────────────────

const SLICE_COLORS = [
  '#234090', '#ffa200', '#8a2e1e',
  '#3d6ae6', '#855400', '#c5422b',
  '#172a5e', '#b03b26', '#ffd17a',
  '#1a4acb', '#78a1de', '#c27b00', '#a9c3ea',
];

type Slice = { path: string; color: string; label: string; count: number; pct: number };
type TipState = { label: string; count: number; pct: number; x: number; y: number } | null;

function Tip({ tip }: { tip: TipState }) {
  if (!tip) return null;
  return (
    <div style={{
      position: 'fixed',
      left: tip.x + 14,
      top: tip.y - 56,
      background: '#1E3266',
      color: '#fff',
      padding: '7px 11px',
      borderRadius: 7,
      fontSize: 12,
      lineHeight: 1.55,
      pointerEvents: 'none',
      zIndex: 1000,
      maxWidth: 230,
      boxShadow: '0 3px 10px rgba(0,0,0,.3)',
    }}>
      <div style={{ fontWeight: 600 }}>{tip.label}</div>
      <div style={{ opacity: 0.85 }}>{tip.count.toLocaleString()} · {tip.pct}% of total</div>
    </div>
  );
}

// ── PieChart component ────────────────────────────────────────────────────────

function computeSlices(buckets: Bucket[], baseTotal: number, field: string, numeric?: boolean): Slice[] {
  if (baseTotal === 0 || buckets.length === 0) return [];
  const sorted = numeric
    ? [...buckets].sort((a, b) => Number(a.value) - Number(b.value))
    : buckets;
  const answered = sorted.reduce((s, b) => s + b.count, 0);
  const unanswered = Math.max(0, baseTotal - answered);

  // Merge explicit "declined" responses with unanswered (NULL) into one slice
  let noResponseCount = unanswered;
  const mainBuckets = sorted.filter(b => {
    if (b.value === 'declined') { noResponseCount += b.count; return false; }
    return true;
  });

  const items: { label: string; count: number; color: string }[] = [
    ...mainBuckets.map((b, i) => ({
      label: displayValue(field, b.value),
      count: b.count,
      color: SLICE_COLORS[i % SLICE_COLORS.length],
    })),
    ...(noResponseCount > 0 ? [{ label: 'No response', count: noResponseCount, color: '#EDE8DF' }] : []),
  ];

  const total = items.reduce((s, b) => s + b.count, 0);
  const cx = 80, cy = 80, r = 72;
  let angle = -Math.PI / 2;

  return items
    .filter(b => b.count > 0)
    .map(b => {
      const fraction = b.count / total;
      const sweep = fraction * 2 * Math.PI;
      const startAngle = angle;
      angle += sweep;

      let path: string;
      if (fraction >= 0.9999) {
        path = `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}`;
      } else {
        const x1 = (cx + r * Math.cos(startAngle)).toFixed(2);
        const y1 = (cy + r * Math.sin(startAngle)).toFixed(2);
        const x2 = (cx + r * Math.cos(angle)).toFixed(2);
        const y2 = (cy + r * Math.sin(angle)).toFixed(2);
        const la = sweep > Math.PI ? 1 : 0;
        path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${la} 1 ${x2} ${y2} Z`;
      }

      return { path, color: b.color, label: b.label, count: b.count, pct: Math.round(fraction * 100) };
    });
}

function PieChart({ data, baseTotal, field, numeric }: {
  data: Bucket[];
  baseTotal: number;
  field: string;
  numeric?: boolean;
}) {
  const [tip, setTip] = useState<TipState>(null);
  const slices = computeSlices(data, baseTotal, field, numeric);
  if (slices.length === 0) {
    return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No data</p>;
  }

  return (
    <div className={`pie-wrap${slices.length > 6 ? ' legend-below' : ''}`}>
      <svg
        viewBox="0 0 160 160"
        aria-hidden="true"
        onMouseLeave={() => setTip(null)}
      >
        {slices.map((s, i) => (
          <path
            key={i}
            d={s.path}
            style={{ fill: s.color, stroke: 'var(--surface)', strokeWidth: 1.5, cursor: 'pointer' }}
            onMouseMove={e => setTip({ label: s.label, count: s.count, pct: s.pct, x: e.clientX, y: e.clientY })}
          />
        ))}
      </svg>
      <Tip tip={tip} />
      <div className="pie-legend">
        {slices.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {s.label}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {s.count.toLocaleString()}&thinsp;·&thinsp;{s.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Binary pill chart (strict yes/no fields) ─────────────────────────────────

function BinaryPillChart({ data, baseTotal, field }: { data: Bucket[]; baseTotal: number; field: string }) {
  const [tip, setTip] = useState<TipState>(null);
  const b0 = data[0], b1 = data[1];
  if (!b0 || !b1) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No data</p>;
  const total = b0.count + b1.count;
  if (total === 0) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No data</p>;
  const pct0 = Math.round((b0.count / total) * 100);
  const pct1 = 100 - pct0;
  const tp0 = baseTotal > 0 ? Math.round((b0.count / baseTotal) * 100) : pct0;
  const tp1 = baseTotal > 0 ? Math.round((b1.count / baseTotal) * 100) : pct1;
  return (
    <div>
      <div
        style={{ display: 'flex', height: 36, borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}
        onMouseLeave={() => setTip(null)}
      >
        {pct0 > 0 && (
          <div
            style={{ width: `${pct0}%`, background: SLICE_COLORS[0], display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            onMouseMove={e => setTip({ label: displayValue(field, b0.value), count: b0.count, pct: tp0, x: e.clientX, y: e.clientY })}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{pct0}%</span>
          </div>
        )}
        {pct1 > 0 && (
          <div
            style={{ width: `${pct1}%`, background: SLICE_COLORS[1], display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            onMouseMove={e => setTip({ label: displayValue(field, b1.value), count: b1.count, pct: tp1, x: e.clientX, y: e.clientY })}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{pct1}%</span>
          </div>
        )}
      </div>
      <Tip tip={tip} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
        {[b0, b1].map((b, i) => (
          <div key={b.value} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: SLICE_COLORS[i], flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {displayValue(field, b.value)}: <strong style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{b.count.toLocaleString()}</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Column chart (ordinal numeric fields) ─────────────────────────────────────

function ColumnChart({ data, baseTotal, field }: { data: Bucket[]; baseTotal: number; field: string }) {
  const [tip, setTip] = useState<TipState>(null);
  if (data.length === 0) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No data</p>;
  const sorted = [...data].sort((a, b) => Number(a.value) - Number(b.value));
  const max = Math.max(...sorted.map(b => b.count), 1);
  const BAR_H = 80;
  const half = Math.ceil(sorted.length / 2);
  const legendRow = (b: Bucket, colorIdx: number) => (
    <div key={b.value} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: SLICE_COLORS[colorIdx % SLICE_COLORS.length], flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {displayValue(field, b.value)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {b.count.toLocaleString()}
      </span>
    </div>
  );
  return (
    <div className={`col-wrap${sorted.length > 6 ? ' legend-below' : ''}`} onMouseLeave={() => setTip(null)}>
      {/* bars + axis labels, bottom-aligned */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: BAR_H }}>
          {sorted.map((b, i) => {
            const h = Math.max(4, Math.round((b.count / max) * BAR_H));
            const pct = baseTotal > 0 ? Math.round((b.count / baseTotal) * 100) : 0;
            return (
              <div
                key={b.value}
                style={{ flex: 1, height: h, background: SLICE_COLORS[i % SLICE_COLORS.length], borderRadius: '3px 3px 0 0', cursor: 'pointer', minWidth: 0 }}
                onMouseMove={e => setTip({ label: displayValue(field, b.value), count: b.count, pct, x: e.clientX, y: e.clientY })}
              />
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          {sorted.map(b => (
            <div key={b.value} style={{ flex: 1, fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', minWidth: 0 }}>
              {b.value}
            </div>
          ))}
        </div>
      </div>
      {/* legend: two halves side-by-side on mobile and desktop >6 */}
      <div className="col-legend">
        <div className="col-legend-half">
          {sorted.slice(0, half).map((b, i) => legendRow(b, i))}
        </div>
        <div className="col-legend-half">
          {sorted.slice(half).map((b, i) => legendRow(b, half + i))}
        </div>
      </div>
      <Tip tip={tip} />
    </div>
  );
}

// ── Horizontal bar chart (many-value fields: ZIP, ethnicity) ──────────────────

function HBarChart({ data, baseTotal, field }: { data: Bucket[]; baseTotal: number; field: string }) {
  const [tip, setTip] = useState<TipState>(null);
  if (data.length === 0) return <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No data</p>;
  const max = Math.max(...data.map(b => b.count), 1);
  return (
    <div onMouseLeave={() => setTip(null)}>
      {data.map((b, i) => {
        const pct = baseTotal > 0 ? Math.round((b.count / baseTotal) * 100) : 0;
        return (
          <div
            key={b.value}
            style={{ display: 'flex', alignItems: 'center', marginBottom: 6, cursor: 'pointer' }}
            onMouseMove={e => setTip({ label: displayValue(field, b.value), count: b.count, pct, x: e.clientX, y: e.clientY })}
          >
            <span style={{ width: 80, flexShrink: 0, fontSize: 12, color: 'var(--text)', textAlign: 'right', paddingRight: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayValue(field, b.value)}
            </span>
            <div style={{ flex: 1, height: 18, background: 'var(--surface-2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${(b.count / max) * 100}%`, height: '100%', background: SLICE_COLORS[i % SLICE_COLORS.length], borderRadius: 4 }} />
            </div>
            <span style={{ width: 72, flexShrink: 0, paddingLeft: 8, fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {b.count.toLocaleString()} ({pct}%)
            </span>
          </div>
        );
      })}
      <Tip tip={tip} />
    </div>
  );
}

// ── Chart type routing ────────────────────────────────────────────────────────

const BINARY_CHART_FIELDS = new Set(['bag_received', 'receives_texts']);
const COLUMN_CHART_FIELDS = new Set(['num_people', 'num_children_under_18', 'num_children_under_5', 'num_with_diabetes']);
const HBAR_CHART_FIELDS   = new Set(['zip_code', 'ethnicity']);

function ChartRenderer({ data, baseTotal, field, numeric }: {
  data: Bucket[];
  baseTotal: number;
  field: string;
  numeric?: boolean;
}) {
  if (BINARY_CHART_FIELDS.has(field)) return <BinaryPillChart data={data} baseTotal={baseTotal} field={field} />;
  if (COLUMN_CHART_FIELDS.has(field)) return <ColumnChart data={data} baseTotal={baseTotal} field={field} />;
  if (HBAR_CHART_FIELDS.has(field))   return <HBarChart data={data} baseTotal={baseTotal} field={field} />;
  return <PieChart data={data} baseTotal={baseTotal} field={field} numeric={numeric} />;
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
          {presetBtn('all',       'All time')}
          {presetBtn('lastmonth', lastMonthLabel())}
          {presetBtn('month',     'Past month')}
          {presetBtn('3months',   'Past 3 months')}
          {presetBtn('year',      'Past year')}
          {presetBtn('custom',    'Custom')}
        </div>
        {preset === 'custom' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
            <div>
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
        <>
          {CHART_SECTIONS.map(section => (
            <div key={section.label} className="summary-chart-section">
              <div className="summary-chart-section-head">
                <div style={{ width: 10, height: 10, borderRadius: 2, background: section.color, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-muted)' }}>
                  {section.label}
                </span>
              </div>
              <div className="summary-chart-grid">
                {[0, 1].map(col => (
                  <div key={col} className="summary-chart-col">
                    {section.charts.filter((_, i) => i % 2 === col).map(def => {
                      const data = summary.fields[def.key] ?? [];
                      const isBar = BINARY_CHART_FIELDS.has(def.key) || HBAR_CHART_FIELDS.has(def.key) || COLUMN_CHART_FIELDS.has(def.key);
                      return (
                        <div key={def.key} style={{ ...card, borderTop: `4px solid ${section.color}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: isBar ? 20 : 14 }}>
                            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{def.label}</p>
                            {def.note && (
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{def.note}</span>
                            )}
                          </div>
                          <ChartRenderer
                            data={data}
                            baseTotal={summary.totals.families}
                            field={def.key}
                            numeric={def.numeric}
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
