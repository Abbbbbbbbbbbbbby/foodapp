import type { Family, Visit, NewFamily, NewVisit } from './schema';
import { levenshtein, normalizeName, normalizePhone, rankName, compareRank } from '../shared/fuzzy';
// Re-exported: routes and tests import these from db.ts.
export { levenshtein, normalizeName, normalizePhone };

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
    const normToken = normalizeName(token);
    const normFull = normalizeName(name.trim());

    // Levenshtein over EVERY stored name, no SQL prefilter. Earlier versions
    // prefiltered with LIKE needles (prefix, then bigram variants), and every
    // finite needle set left some legitimate one-edit typo unreachable
    // ('Msith', then 'Sxith'). The contract is "matches within edit distance
    // N are found" — the only way to guarantee it is to score every name.
    // The matching/tier logic itself lives in shared/fuzzy.ts because the
    // PWA's offline directory must behave IDENTICALLY. The dataset is a few
    // thousand rows and this first pass pulls only id + normalized name, so
    // the scan stays cheap; full rows are fetched afterward for the matches.
    const allNames = await db.prepare(
      `SELECT id, COALESCE(name_normalized, LOWER(name)) AS norm FROM families`
    ).all<{ id: string; norm: string }>();

    const matches: ({ id: string } & import('../shared/fuzzy').FuzzyRank)[] = [];
    for (const r of allNames.results ?? []) {
      const rank = rankName(r.norm, normToken, normFull);
      if (rank) matches.push({ id: r.id, ...rank });
    }
    // Rank BEFORE any cap: exact tiers first, then closest by whichever
    // metric matched. 270 near-miss 'Smath' rows must never crowd out an
    // exact-surname 'Alexandria Verylongname Smith'.
    matches.sort(compareRank);
    // Fetch details for ALL ranked matches up to a response ceiling, in
    // chunks under D1's per-statement bind-parameter limit. The ceiling only
    // trims degenerate 1-2 char queries, and ranking guarantees anything it
    // trims scored worse than 270 closer names.
    const ids = matches.slice(0, 270).map(m => m.id);

    const nameRows: FamilySearchResult[] = [];
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const detail = await db.prepare(`
        SELECT f.*, MAX(v.visit_date) as last_visit_date
        FROM families f
        LEFT JOIN visits v ON v.family_id = f.id
        WHERE f.id IN (${chunk.map(() => '?').join(',')})
        GROUP BY f.id
      `).bind(...chunk).all<Record<string, unknown>>();
      for (const r of detail.results ?? []) nameRows.push(mapRow(r) as FamilySearchResult);
    }

    const existing = new Set(rows.map(r => r.id));
    for (const r of nameRows) {
      if (!existing.has(r.id)) {
        rows.push(r);
        existing.add(r.id);
      }
    }

    // Display order uses the SAME tiers as the cap — an exact-surname match
    // must not survive the cap only to sink beneath near-miss junk on screen.
    const rankById = new Map(matches.map(m => [m.id, m]));
    const FALLBACK = { tier: 3, minDist: 99, fullDist: 99 };
    rows.sort((a, b) => {
      // Guarded: on a name-only search normPhone is null, and null === null
      // would otherwise rank every phoneless row "first", garbling the sort.
      if (normPhone) {
        if (a.phone === normPhone) return -1;
        if (b.phone === normPhone) return 1;
      }
      const ra = rankById.get(a.id) ?? FALLBACK;
      const rb = rankById.get(b.id) ?? FALLBACK;
      return (ra.tier - rb.tier) || (ra.minDist - rb.minDist) || (ra.fullDist - rb.fullDist)
        // Equal-rank ties: most recently seen family first.
        || (b.last_visit_date ?? '').localeCompare(a.last_visit_date ?? '');
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

  // Excludes a self-referencing proxy row (proxy_phone == the family's own
  // phone) — "Who usually picks up?" -> "The person here today" persists one
  // for any family registering under their own number. Filtered here too
  // (not just at write time) so already-existing bad rows don't resurface
  // the family a second time.
  const proxy = (proxyResult.results ?? [])
    .map(r => mapRow(r) as FamilySearchResult)
    .filter(f => f.id !== own?.id);
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
  ).bind(familyId).all<Record<string, unknown>>();
  // D1 stores booleans as 0/1 — honor the declared Visit contract, which
  // promises bag_received: boolean to API consumers.
  return (result.results ?? []).map(r =>
    ({ ...r, bag_received: r.bag_received === 1 || r.bag_received === true }) as unknown as Visit
  );
}
