// Arizona is fixed UTC-7 year-round — it opts out of Mountain Daylight Time,
// so "MST" is always the correct label with no seasonal edge case to track.
// This is a real simplification (a constant offset), not a timezone-library
// dependency. All D1 timestamps are UTC; these functions are the only place
// AZ-local conversion happens, and they're pure so they're cheap to test.

const AZ_OFFSET_HOURS = 7;

// D1 timestamps mix two formats: client ingests bind ISO-with-T strings
// ("2026-08-19T21:30:00.000Z"), but the column default is datetime('now')'s
// space format ("2026-08-19 21:30:00", no Z). V8's Date parser reads the
// space format as LOCAL time, not UTC — correct only because Workers run at
// TZ=UTC. Normalize explicitly so these functions give the same answer on
// any machine, including a non-UTC dev laptop running the test suite.
function normalizeToParsableUtc(s: string): string {
  return s.includes('T') ? s : `${s.replace(' ', 'T')}Z`;
}

// A <input type="datetime-local"> value ("2026-08-19T14:30", naive, assumed
// America/Phoenix wall time) -> UTC ISO for binding into a D1 query. Returns
// null on anything that doesn't parse OR that parses to a different calendar
// date than typed (e.g. "2026-02-30T10:00" silently rolls to March 2 under
// the native Date parser) — callers treat null as "no filter" rather than
// crashing on, or silently misinterpreting, a hand-edited query string.
export function azLocalToUtcIso(local: string): string | null {
  if (!local) return null;
  const withSeconds = local.length === 16 ? `${local}:00` : local;
  const d = new Date(`${withSeconds}-07:00`);
  if (isNaN(d.getTime())) return null;
  // Round-trip check: format the parsed instant back to the same AZ-local
  // wall-clock string and compare. A calendar-invalid input (Feb 30, hour 24)
  // rolls into a different date under Date's normalization, which this catches.
  if (utcToAzLocalInputValue(d.toISOString()) !== withSeconds.slice(0, 16)) return null;
  return d.toISOString();
}

// UTC ISO -> a value usable directly as a <input type="datetime-local">
// value, in fixed AZ time. Used to pre-fill the filter form (e.g. the home
// page's "errors in the last 24h" link) with a value that round-trips
// through azLocalToUtcIso above.
export function utcToAzLocalInputValue(utcIso: string): string {
  const d = new Date(new Date(normalizeToParsableUtc(utcIso)).getTime() - AZ_OFFSET_HOURS * 3600_000);
  return d.toISOString().slice(0, 16);
}

// UTC ISO -> human display string in AZ local time, for on-screen table
// rendering (the event-detail page keeps UTC for precision — see DESIGN.md).
// occurred_at is client-supplied on an unauthenticated ingest route and is
// never format-validated there, so a garbage value reaching this function is
// expected input, not a bug elsewhere: show it raw rather than throwing (a
// naive toISOString() on an invalid Date throws RangeError) or hiding it —
// a malformed timestamp is itself a triage signal a staffer needs to see.
export function utcToAzDisplay(utcIso: string | null | undefined): string {
  if (!utcIso) return '';
  const t = new Date(normalizeToParsableUtc(utcIso)).getTime();
  if (Number.isNaN(t)) return utcIso;
  const d = new Date(t - AZ_OFFSET_HOURS * 3600_000);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} MST`;
}
