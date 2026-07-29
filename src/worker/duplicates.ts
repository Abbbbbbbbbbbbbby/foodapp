import { levenshtein, normalizeName } from './db';

// Runs after every new family creation. Loads all existing families and flags
// any that share a phone number, exact name, or sufficiently similar name.
// Pair ordering is normalized (smaller ID first) so (A,B) and (B,A) never
// both appear — the UNIQUE constraint on the table enforces this at DB level too.
export async function checkForDuplicates(
  db: D1Database,
  newFamilyId: string,
  name: string,
  phone: string | null
): Promise<void> {
  const { results } = await db.prepare(
    `SELECT id, name, phone FROM families WHERE id != ?`
  ).bind(newFamilyId).all<{ id: string; name: string; phone: string | null }>();

  const normNew = normalizeName(name);

  for (const fam of (results ?? [])) {
    let reason: string | null = null;

    if (phone && fam.phone === phone) {
      reason = 'phone';
    } else if (normalizeName(fam.name) === normNew) {
      reason = 'name_exact';
    } else if (levenshtein(normNew, normalizeName(fam.name)) <= 3) {
      reason = 'name_fuzzy';
    }

    if (!reason) continue;

    const [a, b] = newFamilyId < fam.id
      ? [newFamilyId, fam.id]
      : [fam.id, newFamilyId];

    const flagId = crypto.randomUUID().replace(/-/g, '');
    await db.prepare(`
      INSERT OR IGNORE INTO duplicate_flags (id, family_a_id, family_b_id, reason)
      VALUES (?, ?, ?, ?)
    `).bind(flagId, a, b, reason).run();
  }
}

const NULLABLE_FIELDS = [
  'phone', 'address', 'zip_code', 'date_of_birth', 'language', 'ethnicity',
  'hispanic', 'ami_bracket', 'num_people', 'num_children_under_18',
  'num_children_under_5', 'num_with_diabetes', 'health_insurance', 'snap_benefits',
  'receives_texts', 'want_text_updates', 'id_confirmed', 'bag_received',
  'first_visit_date',
];

// Merges discard into keep: fills null fields, moves visits and proxies,
// then deletes the discard family. Caller is responsible for updating the flag status.
export async function mergeFamilies(
  db: D1Database,
  keepId: string,
  discardId: string
): Promise<void> {
  const [keep, discard] = await Promise.all([
    db.prepare(`SELECT * FROM families WHERE id = ?`).bind(keepId).first<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM families WHERE id = ?`).bind(discardId).first<Record<string, unknown>>(),
  ]);
  if (!keep || !discard) throw new Error('Family not found');

  // Fill any null fields on keep from discard
  const sets = NULLABLE_FIELDS.map(f => `${f} = COALESCE(${f}, ?)`);
  const vals: unknown[] = NULLABLE_FIELDS.map(f => discard[f] ?? null);
  vals.push(keepId);
  await db.prepare(
    `UPDATE families SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`
  ).bind(...vals).run();

  // Move visits from discard to keep (only dates not already present in keep)
  await db.prepare(`
    INSERT INTO visits (id, family_id, visit_date, picked_up_by_phone, volunteer_id, created_at)
    SELECT lower(hex(randomblob(16))), ?, visit_date, picked_up_by_phone, volunteer_id, created_at
    FROM visits
    WHERE family_id = ?
    AND visit_date NOT IN (SELECT visit_date FROM visits WHERE family_id = ?)
  `).bind(keepId, discardId, keepId).run();

  // Move proxies from discard to keep (only phone numbers not already present)
  await db.prepare(`
    INSERT INTO proxies (id, family_id, proxy_name, proxy_phone, created_at)
    SELECT lower(hex(randomblob(16))), ?, proxy_name, proxy_phone, created_at
    FROM proxies p
    WHERE p.family_id = ?
    AND (p.proxy_phone IS NULL OR p.proxy_phone NOT IN (
      SELECT proxy_phone FROM proxies WHERE family_id = ? AND proxy_phone IS NOT NULL
    ))
  `).bind(keepId, discardId, keepId).run();

  // Delete discard (visits and proxies first since no ON DELETE CASCADE)
  await db.prepare(`DELETE FROM visits WHERE family_id = ?`).bind(discardId).run();
  await db.prepare(`DELETE FROM proxies WHERE family_id = ?`).bind(discardId).run();
  await db.prepare(`DELETE FROM families WHERE id = ?`).bind(discardId).run();
}
