import { EVENT_COLUMNS, type ClientEventRow } from './db';

// RFC 4180 quoting plus an Excel formula-injection guard. Every field here is
// attacker-controlled (ingest is unauthenticated), so the guard follows the
// OWASP CSV-injection list: a cell is dangerous if, after any leading
// tab/CR/LF whitespace Excel skips, it starts with = + - or @. The apostrophe
// goes on the ORIGINAL string so the leading control characters are
// neutralized inside the quoted value too.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[\t\r\n ]*[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Peak-memory budget for the buffered artifact: max-size hostile rows through
// D1 results + escaped copies + the final join can otherwise brush the 128 MB
// isolate limit at the 2000-row cap. 8M chars ≈ ≤16 MB UTF-8 keeps every
// intermediate comfortably small.
const MAX_CSV_CHARS = 8_000_000;

// Row-cap and byte-budget truncation are DISTINCT facts: a byte-budget cut can
// be an abuse signal (oversized hostile rows), a row-cap cut just means "too
// many matches, narrow the filter." Never collapse them into one boolean —
// the operator must be able to tell which from both the log and the artifact.
export type TruncationReason = 'none' | 'row-cap' | 'byte-budget';

export function toCsv(
  rows: ClientEventRow[], truncatedByCap: boolean
): { csv: string; rowsWritten: number; reason: TruncationReason } {
  const lines = [EVENT_COLUMNS.join(',')];
  let chars = lines[0].length;
  let rowsWritten = 0;
  let truncatedByBytes = false;
  for (const row of rows) {
    const line = EVENT_COLUMNS.map(col => csvCell(row[col])).join(',');
    if (chars + line.length > MAX_CSV_CHARS) {
      truncatedByBytes = true;
      break;
    }
    lines.push(line);
    chars += line.length + 2;
    rowsWritten++;
  }
  // Byte-budget wins if both fired: it's the more urgent signal, and it means
  // fewer rows came out than the row cap would have allowed.
  const reason: TruncationReason = truncatedByBytes ? 'byte-budget' : truncatedByCap ? 'row-cap' : 'none';
  if (reason !== 'none') {
    // The artifact itself carries which kind of incompleteness, not just that.
    const label = reason === 'byte-budget' ? 'byte budget' : 'row cap';
    lines.push(`# TRUNCATED at ${rowsWritten} rows (${label}) — narrow the filters`);
  }
  return { csv: lines.join('\r\n') + '\r\n', rowsWritten, reason };
}
