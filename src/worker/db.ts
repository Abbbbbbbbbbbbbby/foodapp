import type { Family, Visit, NewFamily, NewVisit } from './schema';

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
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

// Lowercase + strip combining marks so LIKE searches match accented names.
// Stored in name_normalized column; also applied to the query prefix before binding.
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// D1 stores booleans as 0/1 integers; convert them back to JS booleans on
// every read path so callers can use strict comparisons safely.
const BOOL_COLS = new Set(['receives_texts', 'want_text_updates', 'id_confirmed', 'bag_received']);

function mapRow(row: Record<string, unknown>): Family {
  const out: Record<string, unknown> = { ...row };
  for (const col of BOOL_COLS) {
    if (out[col] !== null && out[col] !== undefined) {
      out[col] = out[col] === 1 || out[col] === true;
    }
  }
  return out as unknown as Family;
}

export async function insertFamily(
  db: D1Database,
  data: NewFamily,
  idempotencyKey?: string
): Promise<{ id: string; created: boolean }> {
  // Dedup: if an offline-queue replay carries the same key, return the
  // already-created record instead of inserting a duplicate.
  if (idempotencyKey) {
    const existing = await db.prepare(
      `SELECT id FROM families WHERE idempotency_key = ?`
    ).bind(idempotencyKey).first<{ id: string }>();
    if (existing) return { id: existing.id, created: false };
    // The key may belong to a family that was merged away — resolve to the
    // survivor instead of re-creating the duplicate the merge eliminated.
    // JOIN guards against dangling aliases (target deleted after the merge):
    // a dangling alias must fall through to a fresh insert, not return a dead id.
    const alias = await db.prepare(
      `SELECT mk.target_id FROM merged_keys mk JOIN families f ON f.id = mk.target_id
       WHERE mk.idempotency_key = ? AND mk.kind = 'family'`
    ).bind(idempotencyKey).first<{ target_id: string }>();
    if (alias) return { id: alias.target_id, created: false };
  }

  const id = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  try {
    await db.prepare(`
      INSERT INTO families (
        id, name, name_normalized, phone, address, zip_code, date_of_birth, language, ethnicity,
        hispanic, ami_bracket, num_people, num_children_under_18, num_children_under_5,
        num_with_diabetes, health_insurance, snap_benefits, receives_texts,
        want_text_updates, id_confirmed, bag_received, first_visit_date,
        created_by, created_at, updated_at, idempotency_key
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `).bind(
      id, data.name, normalizeName(data.name),
      normalizePhone(data.phone), data.address, data.zip_code,
      data.date_of_birth, data.language, data.ethnicity,
      data.hispanic, data.ami_bracket, data.num_people, data.num_children_under_18,
      data.num_children_under_5, data.num_with_diabetes, data.health_insurance,
      data.snap_benefits, data.receives_texts ? 1 : data.receives_texts === false ? 0 : null,
      data.want_text_updates ? 1 : data.want_text_updates === false ? 0 : null,
      data.id_confirmed ? 1 : data.id_confirmed === false ? 0 : null,
      data.bag_received ? 1 : data.bag_received === false ? 0 : null,
      data.first_visit_date, data.created_by, now, now, idempotencyKey ?? null
    ).run();
  } catch (err) {
    // Race between two concurrent flushes with the same key: re-select the winner
    if (idempotencyKey && err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      const existing = await db.prepare(
        `SELECT id FROM families WHERE idempotency_key = ?`
      ).bind(idempotencyKey).first<{ id: string }>();
      if (existing) return { id: existing.id, created: false };
    }
    throw err;
  }
  return { id, created: true };
}

export async function getFamilyById(db: D1Database, id: string): Promise<Family | null> {
  const row = await db.prepare(
    `SELECT * FROM families WHERE id = ?`
  ).bind(id).first<Record<string, unknown>>();
  return row ? mapRow(row) : null;
}

const UPDATABLE_FAMILY_COLUMNS = new Set([
  'name', 'phone', 'address', 'zip_code', 'date_of_birth', 'language', 'ethnicity',
  'hispanic', 'ami_bracket', 'num_people', 'num_children_under_18', 'num_children_under_5',
  'num_with_diabetes', 'health_insurance', 'snap_benefits', 'receives_texts',
  'want_text_updates', 'id_confirmed', 'bag_received', 'first_visit_date',
]);

export async function updateFamily(
  db: D1Database,
  id: string,
  data: Partial<NewFamily>
): Promise<void> {
  const entries = Object.entries(data).filter(([k]) => UPDATABLE_FAMILY_COLUMNS.has(k));
  if (entries.length === 0) return;

  // When updating name, also update the normalized version for search
  const updatesName = entries.some(([k]) => k === 'name');
  const extra: [string, unknown][] = updatesName
    ? [['name_normalized', normalizeName(data.name as string)]]
    : [];

  const allEntries = [...entries, ...extra];
  const fields = allEntries.map(([k]) => `${k} = ?`).join(', ');
  const values = allEntries.map(([k, v]) =>
    k === 'phone' ? normalizePhone(v as string | null) : v
  );
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE families SET ${fields}, updated_at = ? WHERE id = ?`
  ).bind(...values, now, id).run();
}

export interface SearchParams {
  phone?: string;
  name?: string;
}

export interface FamilySearchResult extends Family {
  last_visit_date: string | null;
}

function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export async function searchFamilies(
  db: D1Database,
  params: SearchParams
): Promise<FamilySearchResult[]> {
  const { phone, name } = params;
  const normPhone = normalizePhone(phone ?? null);

  let rows: FamilySearchResult[] = [];

  if (normPhone) {
    const phoneResults = await db.prepare(`
      SELECT f.*, MAX(v.visit_date) as last_visit_date
      FROM families f
      LEFT JOIN visits v ON v.family_id = f.id
      WHERE f.phone = ?
      GROUP BY f.id
    `).bind(normPhone).all<Record<string, unknown>>();
    rows = (phoneResults.results ?? []).map(r => mapRow(r) as FamilySearchResult);
  }

  if (name && name.trim().length >= 2) {
    const token = name.trim().split(/\s+/)[0];
    // Broad candidate pull, precise post-ranking (per the design spec): an
    // anchored 4-char prefix rejected transpositions ('Smiht'→'Smith') and
    // any non-first-token match ('Garcia' couldn't find 'Jose Garcia').
    // Anywhere-substring on the first two characters is forgiving enough for
    // the Levenshtein filter to see real candidates, and the dataset is a
    // few thousand rows, so LIMIT 300 stays cheap.
    const normToken = normalizeName(token);
    const bigram = normToken.slice(0, 2);
    // Candidate reachability: requiring the typo's LEADING bigram to appear
    // contiguously makes common edits unreachable ('Msith' contains no 'sm').
    // Pull candidates on any of: the leading bigram, its transposition, and
    // the second bigram (survives a first-character edit).
    const bigrams = new Set([bigram]);
    if (bigram.length === 2) {
      bigrams.add(bigram[1] + bigram[0]);
      if (normToken.length >= 3) bigrams.add(normToken.slice(1, 3));
    }
    const needles = [...bigrams].map(escapeLike);
    const fullNeedle = escapeLike(normToken);
    const NORM = `COALESCE(f.name_normalized, LOWER(f.name))`;
    // The cap must keep the BEST candidates, not an arbitrary scan-order 300:
    // a common bigram ('ma') can match most of the table, and an unranked
    // LIMIT could truncate the exact family being checked in. Rank exact-token
    // substrings first (near-certain Levenshtein survivors), then names where
    // ANY token starts with the bigram (last-name searches like 'Martines' →
    // 'Jose Martinez'), then recency.
    const likeResults = await db.prepare(`
      SELECT f.*, MAX(v.visit_date) as last_visit_date
      FROM families f
      LEFT JOIN visits v ON v.family_id = f.id
      WHERE ${needles.map(() => `${NORM} LIKE ? ESCAPE '\\'`).join(' OR ')}
      GROUP BY f.id
      ORDER BY
        (${NORM} LIKE ? ESCAPE '\\') DESC,
        (${NORM} LIKE ? ESCAPE '\\' OR ${NORM} LIKE ? ESCAPE '\\') DESC,
        last_visit_date DESC
      LIMIT 300
    `).bind(
      ...needles.map(n => `%${n}%`),
      `%${fullNeedle}%`,
      `${escapeLike(bigram)}%`, `% ${escapeLike(bigram)}%`,
    ).all<Record<string, unknown>>();

    const nameRows = (likeResults.results ?? [])
      .map(r => mapRow(r) as FamilySearchResult)
      .filter(r => {
        // Match against EVERY token of the stored name, so a last-name
        // search finds full-name records.
        const storedTokens = normalizeName(r.name).split(/\s+/);
        return storedTokens.some(t => levenshtein(t, normToken) <= (normToken.length <= 4 ? 2 : 3));
      });

    const existing = new Set(rows.map(r => r.id));
    for (const r of nameRows) {
      if (!existing.has(r.id)) {
        rows.push(r);
        existing.add(r.id);
      }
    }

    rows.sort((a, b) => {
      if (a.phone === normPhone) return -1;
      if (b.phone === normPhone) return 1;
      return levenshtein(normalizeName(a.name), normalizeName(name)) -
             levenshtein(normalizeName(b.name), normalizeName(name));
    });
  }

  return rows;
}

export interface PickupResult {
  own: FamilySearchResult | null;
  proxy: FamilySearchResult[];
}

export async function getFamiliesForPickup(
  db: D1Database,
  phone: string
): Promise<PickupResult> {
  const normPhone = normalizePhone(phone);
  if (!normPhone) return { own: null, proxy: [] };

  const ownRow = await db.prepare(`
    SELECT f.*, MAX(v.visit_date) as last_visit_date
    FROM families f
    LEFT JOIN visits v ON v.family_id = f.id
    WHERE f.phone = ?
    GROUP BY f.id
  `).bind(normPhone).first<Record<string, unknown>>();

  const own = ownRow ? (mapRow(ownRow) as FamilySearchResult) : null;

  const proxyResult = await db.prepare(`
    SELECT f.*, MAX(v.visit_date) as last_visit_date
    FROM families f
    JOIN proxies p ON p.family_id = f.id
    LEFT JOIN visits v ON v.family_id = f.id
    WHERE p.proxy_phone = ?
    GROUP BY f.id
  `).bind(normPhone).all<Record<string, unknown>>();

  const proxy = (proxyResult.results ?? []).map(r => mapRow(r) as FamilySearchResult);
  return { own, proxy };
}

export async function insertVisit(
  db: D1Database,
  data: NewVisit,
  idempotencyKey?: string
): Promise<{ id: string; created: boolean }> {
  if (idempotencyKey) {
    const existing = await db.prepare(
      `SELECT id FROM visits WHERE idempotency_key = ?`
    ).bind(idempotencyKey).first<{ id: string }>();
    if (existing) return { id: existing.id, created: false };
    // Key of a visit that was merged away — resolve to the surviving visit.
    // JOIN guards against dangling aliases (survivor later deleted).
    const alias = await db.prepare(
      `SELECT mk.target_id FROM merged_keys mk JOIN visits v ON v.id = mk.target_id
       WHERE mk.idempotency_key = ? AND mk.kind = 'visit'`
    ).bind(idempotencyKey).first<{ target_id: string }>();
    if (alias) return { id: alias.target_id, created: false };
  }

  const id = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  const bagReceived = data.bag_received ? 1 : 0;
  try {
    await db.prepare(`
      INSERT INTO visits (id, family_id, visit_date, picked_up_by_phone, volunteer_id, bag_received, created_at, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, data.family_id, data.visit_date, data.picked_up_by_phone, data.volunteer_id, bagReceived, now, idempotencyKey ?? null).run();
  } catch (err) {
    if (idempotencyKey && err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      const existing = await db.prepare(
        `SELECT id FROM visits WHERE idempotency_key = ?`
      ).bind(idempotencyKey).first<{ id: string }>();
      if (existing) return { id: existing.id, created: false };
    }
    throw err;
  }
  return { id, created: true };
}

export async function getVisitsByFamily(db: D1Database, familyId: string): Promise<Visit[]> {
  const result = await db.prepare(
    `SELECT * FROM visits WHERE family_id = ? ORDER BY visit_date DESC`
  ).bind(familyId).all<Visit>();
  return result.results ?? [];
}
