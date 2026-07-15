import type { Family, Visit, NewFamily, NewVisit } from './schema';

function levenshtein(a: string, b: string): number {
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

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

export async function insertFamily(db: D1Database, data: NewFamily): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO families (
      id, name, phone, address, zip_code, date_of_birth, language, ethnicity,
      hispanic, ami_bracket, num_people, num_children_under_18, num_children_under_5,
      num_with_diabetes, health_insurance, snap_benefits, receives_texts,
      want_text_updates, id_confirmed, bag_received, first_visit_date,
      created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `).bind(
    id, data.name, normalizePhone(data.phone), data.address, data.zip_code,
    data.date_of_birth, data.language, data.ethnicity,
    data.hispanic, data.ami_bracket, data.num_people, data.num_children_under_18,
    data.num_children_under_5, data.num_with_diabetes, data.health_insurance,
    data.snap_benefits, data.receives_texts ? 1 : data.receives_texts === false ? 0 : null,
    data.want_text_updates ? 1 : data.want_text_updates === false ? 0 : null,
    data.id_confirmed ? 1 : data.id_confirmed === false ? 0 : null,
    data.bag_received ? 1 : data.bag_received === false ? 0 : null,
    data.first_visit_date, data.created_by, now, now
  ).run();
  return id;
}

export async function getFamilyById(db: D1Database, id: string): Promise<Family | null> {
  return db.prepare(`SELECT * FROM families WHERE id = ?`).bind(id).first<Family>();
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
  const fields = entries.map(([k]) => `${k} = ?`).join(', ');
  const values = entries.map(([, v]) => v);
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
    `).bind(normPhone).all<FamilySearchResult>();
    rows = phoneResults.results ?? [];
  }

  if (name && name.trim().length >= 2) {
    const token = name.trim().split(/\s+/)[0];
    // Use a short prefix so typos like "Gonzales" still match "Gonzalez Family".
    // LIKE on full token would miss one-character substitutions.
    const prefix = token.slice(0, Math.min(4, token.length));
    const likeResults = await db.prepare(`
      SELECT f.*, MAX(v.visit_date) as last_visit_date
      FROM families f
      LEFT JOIN visits v ON v.family_id = f.id
      WHERE f.name LIKE ?
      GROUP BY f.id
      LIMIT 100
    `).bind(`${prefix}%`).all<FamilySearchResult>();

    const nameRows = (likeResults.results ?? []).filter(r => {
      // Compare search token against the first word of the stored name
      const storedFirst = r.name.split(/\s+/)[0].toLowerCase();
      const dist = levenshtein(storedFirst, token.toLowerCase());
      return dist <= 3;
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
      return levenshtein(a.name.toLowerCase(), name.toLowerCase()) -
             levenshtein(b.name.toLowerCase(), name.toLowerCase());
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

  const own = await db.prepare(`
    SELECT f.*, MAX(v.visit_date) as last_visit_date
    FROM families f
    LEFT JOIN visits v ON v.family_id = f.id
    WHERE f.phone = ?
    GROUP BY f.id
  `).bind(normPhone).first<FamilySearchResult>() ?? null;

  const proxyResult = await db.prepare(`
    SELECT f.*, MAX(v.visit_date) as last_visit_date
    FROM families f
    JOIN proxies p ON p.family_id = f.id
    LEFT JOIN visits v ON v.family_id = f.id
    WHERE p.proxy_phone = ?
    GROUP BY f.id
  `).bind(normPhone).all<FamilySearchResult>();

  return { own, proxy: proxyResult.results ?? [] };
}

export async function insertVisit(db: D1Database, data: NewVisit): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO visits (id, family_id, visit_date, picked_up_by_phone, volunteer_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, data.family_id, data.visit_date, data.picked_up_by_phone, data.volunteer_id, now).run();
  return id;
}

export async function getVisitsByFamily(db: D1Database, familyId: string): Promise<Visit[]> {
  const result = await db.prepare(
    `SELECT * FROM visits WHERE family_id = ? ORDER BY visit_date DESC`
  ).bind(familyId).all<Visit>();
  return result.results ?? [];
}
