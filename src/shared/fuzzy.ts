// Fuzzy-matching primitives shared by the worker's search and the PWA's
// offline directory lookup. One implementation, one behavior: every gap
// between online and offline matching became a duplicate-family path
// ('Sxith' found Smith online but not offline), so the client must run
// EXACTLY this code, not an approximation of it.

// Two-row DP with an optional distance bound. When `max` is given, returns
// max + 1 as soon as the distance provably exceeds it (length difference
// short-circuit + per-row early exit) — the search path runs this against
// every stored name per request, so allocation and wasted rows matter for
// Workers CPU-time limits (and for old iPads offline).
export function levenshtein(a: string, b: string, max = Infinity): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > max) return max + 1;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    const swap = prev; prev = curr; curr = swap;
  }
  return prev[n] > max ? max + 1 : prev[n];
}

// Fallback accent folding for runtimes without String.prototype.normalize
// (the iOS 9.3.5 target): covers the Latin diacritics that actually occur
// in this population's names. Kept deliberately explicit — a lookup table
// beats a clever regex when the failure mode is silent duplicate families.
const ACCENT_MAP: Record<string, string> = {
  á: 'a', à: 'a', â: 'a', ä: 'a', ã: 'a', å: 'a',
  é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ì: 'i', î: 'i', ï: 'i',
  ó: 'o', ò: 'o', ô: 'o', ö: 'o', õ: 'o',
  ú: 'u', ù: 'u', û: 'u', ü: 'u',
  ñ: 'n', ç: 'c', ý: 'y',
};
const ACCENT_RE = /[áàâäãåéèêëíìîïóòôöõúùûüñçý]/g;

// Lowercase + strip combining marks so searches match accented names.
// Uses Unicode NFD when the runtime has it; falls back to the table.
export function normalizeName(s: string): string {
  if (typeof s.normalize === 'function') {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  return s.toLowerCase().replace(ACCENT_RE, ch => ACCENT_MAP[ch] ?? ch);
}

// Exported for tests: the no-normalize path must be provable without
// monkeypatching String.prototype.
export function foldAccentsFallback(s: string): string {
  return s.toLowerCase().replace(ACCENT_RE, ch => ACCENT_MAP[ch] ?? ch);
}

// Canonical form: exactly 10 digits. Strips a leading country code 1 from
// 11-digit numbers. Returns null for anything else (rejects 7–9 digit and
// 12+ digit inputs rather than silently accepting them, so the Twilio `To`
// field is always valid as +1<10digits>).
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

export const TOKEN_THRESHOLD = (token: string) => (token.length <= 4 ? 2 : 3);

export interface FuzzyRank {
  tier: number;    // 0 exact whole-name, 1 exact token, 2 fuzzy
  minDist: number;
  fullDist: number;
}

// The matching + tier contract shared by online search and the offline
// directory: token-wise distance against every stored token (last-name
// searches), whole-query distance (multi-token exact matches), explicit
// exact tiers so neither metric buries the other's exact hits.
export function rankName(storedNorm: string, normToken: string, normFull: string): FuzzyRank | null {
  const tokenThreshold = TOKEN_THRESHOLD(normToken);
  const fullThreshold = TOKEN_THRESHOLD(normFull);
  let tokenDist = Infinity;
  for (const t of storedNorm.split(/\s+/)) {
    // Cap edits at (stored token length - 1): a 1-char token like "A." can
    // only match exactly, a 2-char token like "de"/"la" allows 1 edit.
    // Without this, middle initials and Spanish prepositions fuzzy-match
    // unrelated query tokens that happen to be 2-3 edits away.
    const tThreshold = Math.min(tokenThreshold, Math.max(0, t.length - 1));
    const d = levenshtein(t, normToken, tThreshold);
    if (d <= tThreshold && d < tokenDist) tokenDist = d;
    if (tokenDist === 0) break;
  }
  const fullDist = levenshtein(storedNorm, normFull, fullThreshold);
  if (tokenDist > tokenThreshold && fullDist > fullThreshold) return null;
  const tier = fullDist === 0 ? 0 : tokenDist === 0 ? 1 : 2;
  return { tier, minDist: Math.min(tokenDist, fullDist), fullDist };
}

export function compareRank(a: FuzzyRank, b: FuzzyRank): number {
  return (a.tier - b.tier) || (a.minDist - b.minDist) || (a.fullDist - b.fullDist);
}
