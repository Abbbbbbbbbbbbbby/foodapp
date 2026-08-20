import { EVENT_COLUMNS, type ClientEventRow } from './db';

// RFC 4180 quoting plus an Excel formula-injection guard: a stored message
// like "=SUM(...)" must open as text, not execute, so cells starting with
// = + - @ get a leading apostrophe.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: ClientEventRow[], truncated: boolean): string {
  const lines = [EVENT_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(EVENT_COLUMNS.map(col => csvCell(row[col])).join(','));
  }
  if (truncated) {
    // The artifact itself must carry its incompleteness, not just the log.
    lines.push(`# TRUNCATED at ${rows.length} rows — narrow the filters`);
  }
  return lines.join('\r\n') + '\r\n';
}
