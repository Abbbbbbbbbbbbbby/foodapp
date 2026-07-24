import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { calcAmiBracket } from '../lib/ami';
import type { AmiBracket, YesNoDeclined } from '../lib/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ImportFamily {
  bubble_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
  language: string | null;
  ethnicity: string | null;
  hispanic: YesNoDeclined | null;
  health_insurance: YesNoDeclined | null;
  snap_benefits: YesNoDeclined | null;
  receives_texts: boolean | null;
  want_text_updates: boolean | null;
  id_confirmed: boolean | null;
  bag_received: boolean | null;
  num_people: number | null;
  num_children_under_18: number | null;
  num_children_under_5: number | null;
  num_with_diabetes: number | null;
  ami_bracket: AmiBracket | null;
  first_visit_date: string | null;
  visits: string[];
  proxies: { name: string; phone: string | null }[];
}

interface ParseWarning {
  row: number;
  name: string;
  message: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: { name: string; error: string }[];
}

// ── CSV Parser ────────────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      currentRow.push(field);
      field = '';
    } else if (ch === '\n' && !inQuotes) {
      currentRow.push(field);
      if (currentRow.some(f => f !== '')) rows.push(currentRow);
      currentRow = [];
      field = '';
    } else if (ch === '\r' && !inQuotes) {
      // skip
    } else {
      field += ch;
    }
  }

  if (field || currentRow.length) {
    currentRow.push(field);
    if (currentRow.some(f => f !== '')) rows.push(currentRow);
  }

  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
    return obj;
  });
}

// ── Field Helpers ─────────────────────────────────────────────────────────────

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function parseBubbleDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[1]];
  if (!month) return null;
  return m[3] + '-' + month + '-' + m[2].padStart(2, '0');
}

function parseBubbleDateList(s: string): string[] {
  if (!s.trim()) return [];
  return s.split('\n')
    .map(v => parseBubbleDate(v.trim()))
    .filter((v): v is string => v !== null);
}

function parseBool(s: string): boolean | null {
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
}

function parseYesNoToBool(s: string): boolean | null {
  if (s === 'yes') return true;
  if (s === 'no') return false;
  return null;
}

function parseYesNo(s: string): YesNoDeclined | null {
  if (s === 'yes' || s === 'no' || s === 'declined') return s;
  return null;
}

function parseIntField(s: string): number | null {
  if (!s.trim()) return null;
  const n = parseInt(s, 10);
  return isNaN(n) ? null : n;
}

function parsePhone(s: string): string | null {
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

function parseList(s: string): string[] {
  if (!s.trim()) return [];
  return s.split('\n').map(v => v.trim()).filter(v => v.length > 0);
}

// ── Row Transform ─────────────────────────────────────────────────────────────

function transformRow(raw: Record<string, string>, rowNum: number): {
  family: ImportFamily;
  warnings: ParseWarning[];
} {
  const warnings: ParseWarning[] = [];
  const name = (raw['name_text'] ?? '').trim();

  const numPeople = parseIntField(raw['number_of_people_in_family_number'] ?? '');
  const yearlyIncome = parseIntField(raw['yearly_income_number'] ?? '');

  let ami_bracket: AmiBracket | null = null;
  if (yearlyIncome && yearlyIncome > 0 && numPeople) {
    ami_bracket = calcAmiBracket(yearlyIncome, 'yearly', numPeople);
  }

  // Proxy data: names and phones are parallel newline-separated lists
  const proxyNames = parseList(raw['proxies_list_text'] ?? '');
  const proxyPhones = parseList(raw['proxy_phone_numbers_list_number'] ?? '');
  const proxies: { name: string; phone: string | null }[] = [];
  const proxyCount = Math.max(proxyNames.length, proxyPhones.length);
  for (let i = 0; i < proxyCount; i++) {
    proxies.push({
      name: proxyNames[i] ?? '',
      phone: parsePhone(proxyPhones[i] ?? ''),
    });
  }

  const visitDates = parseBubbleDateList(raw['visit_dates_list_date'] ?? '');
  if (visitDates.length === 0 && (raw['visit_dates_list_date'] ?? '').trim()) {
    warnings.push({ row: rowNum, name, message: 'Could not parse visit date(s)' });
  }

  const phone = parsePhone(raw['phone_number_text'] ?? '');
  if ((raw['phone_number_text'] ?? '').trim() && !phone) {
    warnings.push({ row: rowNum, name, message: `Phone "${raw['phone_number_text']}" could not be normalized` });
  }

  const family: ImportFamily = {
    bubble_id: raw['_id'] ?? '',
    name,
    phone,
    address: (raw['address_text'] ?? '').trim() || null,
    zip_code: (raw['zip_code_text'] ?? '').trim() || null,
    date_of_birth: parseBubbleDate(raw['date_of_birth_date'] ?? ''),
    language: (raw['language_option_os_language'] ?? '').trim() || null,
    ethnicity: (raw['ethnicityos_option_ethnicity'] ?? '').trim() || null,
    hispanic: parseYesNo(raw['hispanic_text'] ?? ''),
    health_insurance: parseYesNo(raw['health_insurance_text'] ?? ''),
    snap_benefits: parseYesNo(raw['snap_benefits_new_text'] ?? ''),
    receives_texts: parseYesNoToBool(raw['currently_receiving_text_messages_text'] ?? ''),
    want_text_updates: parseBool(raw['want_to_recieve_messages_boolean'] ?? ''),
    id_confirmed: parseBool(raw['id_confirmed_boolean'] ?? ''),
    bag_received: parseBool(raw['bag__boolean'] ?? ''),
    num_people: numPeople,
    num_children_under_18: parseIntField(raw['number_of_children_in_family__under_18__number'] ?? ''),
    num_children_under_5: parseIntField(raw['number_of_children_in_family_under_5_number'] ?? ''),
    num_with_diabetes: parseIntField(raw['diabetes_number'] ?? ''),
    ami_bracket,
    first_visit_date: parseBubbleDate(raw['first_time_at_food_distribution_date'] ?? ''),
    visits: visitDates,
    proxies,
  };

  return { family, warnings };
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [families, setFamilies] = useState<ImportFamily[] | null>(null);
  const [warnings, setWarnings] = useState<ParseWarning[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function handleFile(file: File) {
    setResult(null);
    setParseError(null);
    setFamilies(null);
    setWarnings([]);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      try {
        const rows = parseCSV(text);
        if (rows.length === 0) {
          setParseError('No data rows found in file.');
          return;
        }
        if (!rows[0]['name_text']) {
          setParseError('This does not look like a Bubble family export — expected "name_text" column.');
          return;
        }

        const allFamilies: ImportFamily[] = [];
        const allWarnings: ParseWarning[] = [];

        rows.forEach((row, i) => {
          const { family, warnings: w } = transformRow(row, i + 2);
          if (family.name) {
            allFamilies.push(family);
          } else {
            allWarnings.push({ row: i + 2, name: '(blank)', message: 'Skipping row with no name' });
          }
          allWarnings.push(...w);
        });

        setFamilies(allFamilies);
        setWarnings(allWarnings);
      } catch (e) {
        setParseError('Failed to parse CSV: ' + (e instanceof Error ? e.message : 'Unknown error'));
      }
    };
    reader.readAsText(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  async function runImport() {
    if (!families) return;
    setImporting(true);
    try {
      const res = await api.post<ImportResult>('/api/admin/import', { families });
      setResult(res);
      setFamilies(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const totalVisits = families ? families.reduce((n, f) => n + f.visits.length, 0) : 0;
  const totalProxies = families ? families.reduce((n, f) => n + f.proxies.length, 0) : 0;

  return (
    <div className="import-page">
      <div className="import-header">
        <button className="btn-ghost import-back" onClick={() => navigate('/')}>← Back</button>
        <h1 className="import-title">Import from Bubble</h1>
      </div>

      {!result && (
        <>
          <div
            className={'import-dropzone' + (families ? ' import-dropzone-ready' : '')}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={handleFileInput}
            />
            {families ? (
              <p className="import-dropzone-label">
                {fileName} — {families.length} families ready
              </p>
            ) : (
              <>
                <p className="import-dropzone-icon">📂</p>
                <p className="import-dropzone-label">Click or drag a Bubble CSV export here</p>
                <p className="import-dropzone-hint">Export from Bubble → Data → All Families → Download as CSV</p>
              </>
            )}
          </div>

          {parseError && <p className="import-error">{parseError}</p>}

          {families && (
            <div className="import-preview">
              <div className="import-summary-row">
                <div className="import-stat">
                  <span className="import-stat-n">{families.length}</span>
                  <span className="import-stat-label">families</span>
                </div>
                <div className="import-stat">
                  <span className="import-stat-n">{totalVisits}</span>
                  <span className="import-stat-label">visits</span>
                </div>
                <div className="import-stat">
                  <span className="import-stat-n">{totalProxies}</span>
                  <span className="import-stat-label">proxies</span>
                </div>
                {warnings.length > 0 && (
                  <div className="import-stat import-stat-warn">
                    <span className="import-stat-n">{warnings.length}</span>
                    <span className="import-stat-label">warnings</span>
                  </div>
                )}
              </div>

              <p className="import-note">
                Families whose phone number already exists in the database will be skipped.
              </p>

              {warnings.length > 0 && (
                <details className="import-warnings">
                  <summary>Show {warnings.length} warning{warnings.length !== 1 ? 's' : ''}</summary>
                  <ul className="import-warning-list">
                    {warnings.map((w, i) => (
                      <li key={i}>
                        Row {w.row} ({w.name}): {w.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="import-preview-table-wrap">
                <table className="import-preview-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>People</th>
                      <th>AMI</th>
                      <th>Visits</th>
                      <th>Proxies</th>
                    </tr>
                  </thead>
                  <tbody>
                    {families.slice(0, 10).map((f, i) => (
                      <tr key={i}>
                        <td>{f.name}</td>
                        <td>{f.phone ?? '—'}</td>
                        <td>{f.num_people ?? '—'}</td>
                        <td>{f.ami_bracket ?? '—'}</td>
                        <td>{f.visits.length}</td>
                        <td>{f.proxies.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {families.length > 10 && (
                  <p className="import-table-more">…and {families.length - 10} more</p>
                )}
              </div>

              <div className="import-actions">
                <button
                  className="import-run-btn"
                  onClick={runImport}
                  disabled={importing}
                >
                  {importing ? 'Importing…' : `Import ${families.length} families`}
                </button>
                <button className="btn-ghost" onClick={() => { setFamilies(null); setWarnings([]); setFileName(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {result && (
        <div className="import-result">
          <div className="import-result-row">
            <div className="import-stat import-stat-success">
              <span className="import-stat-n">{result.imported}</span>
              <span className="import-stat-label">imported</span>
            </div>
            <div className="import-stat">
              <span className="import-stat-n">{result.skipped}</span>
              <span className="import-stat-label">skipped (duplicate phone)</span>
            </div>
            {result.errors.length > 0 && (
              <div className="import-stat import-stat-warn">
                <span className="import-stat-n">{result.errors.length}</span>
                <span className="import-stat-label">errors</span>
              </div>
            )}
          </div>

          {result.errors.length > 0 && (
            <details className="import-warnings">
              <summary>Show {result.errors.length} error{result.errors.length !== 1 ? 's' : ''}</summary>
              <ul className="import-warning-list">
                {result.errors.map((e, i) => (
                  <li key={i}>{e.name}: {e.error}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="import-actions">
            <button className="btn-primary" onClick={() => navigate('/records')}>
              View Records
            </button>
            <button className="btn-ghost" onClick={() => { setResult(null); setFileName(''); }}>
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
