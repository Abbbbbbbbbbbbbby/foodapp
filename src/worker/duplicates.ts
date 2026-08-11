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

// Merges discard into keep as ONE atomic batch: fills null fields, MOVES
// visits/proxies (UPDATE, not copy — preserves ids, bag_received,
// idempotency_key, and audit metadata), deletes every duplicate_flags row
// referencing the discard family (their NOT NULL FK would otherwise block the
// family delete forever), deletes the discard family, and records the merge in
// record_changes. D1 rolls back the whole batch if any statement fails.
export async function mergeFamilies(
  db: D1Database,
  keepId: string,
  discardId: string,
  reviewerId: string,
  flagId: string
): Promise<void> {
  const [keep, discard] = await Promise.all([
    db.prepare(`SELECT * FROM families WHERE id = ?`).bind(keepId).first<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM families WHERE id = ?`).bind(discardId).first<Record<string, unknown>>(),
  ]);
  if (!keep || !discard) throw new Error('Family not found');

  const sets = NULLABLE_FIELDS.map(f => `${f} = COALESCE(${f}, ?)`);
  const vals: unknown[] = NULLABLE_FIELDS.map(f => discard[f] ?? null);
  vals.push(keepId);

  // Enumerate every flag row the batch will delete (their NOT NULL FK forces
  // it) so the audit record preserves what was collaterally removed.
  const collateral = await db.prepare(
    `SELECT id FROM duplicate_flags WHERE (family_a_id = ? OR family_b_id = ?) AND id != ?`
  ).bind(discardId, discardId, flagId).all<{ id: string }>();

  const auditId = crypto.randomUUID().replace(/-/g, '');
  const auditChanges = JSON.stringify({
    _action: 'merged duplicate family',
    merged_from: { id: discardId, name: discard.name, phone: discard.phone },
    flag_id: flagId,
    collateral_flags_removed: (collateral.results ?? []).map(r => r.id),
  });

  await db.batch([
    // Fill any null fields on keep from discard
    db.prepare(
      `UPDATE families SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`
    ).bind(...vals),
    // Move visits whose date isn't already on keep; leftovers are same-date dupes
    db.prepare(`
      UPDATE visits SET family_id = ?
      WHERE family_id = ?
      AND visit_date NOT IN (SELECT visit_date FROM visits WHERE family_id = ?)
    `).bind(keepId, discardId, keepId),
    db.prepare(`DELETE FROM visits WHERE family_id = ?`).bind(discardId),
    // Move proxies whose phone isn't already on keep; leftovers are dupes
    db.prepare(`
      UPDATE proxies SET family_id = ?
      WHERE family_id = ?
      AND (proxy_phone IS NULL OR proxy_phone NOT IN (
        SELECT proxy_phone FROM proxies WHERE family_id = ? AND proxy_phone IS NOT NULL
      ))
    `).bind(keepId, discardId, keepId),
    db.prepare(`DELETE FROM proxies WHERE family_id = ?`).bind(discardId),
    // Flags referencing discard must go before the family row can (NOT NULL FK);
    // the merge itself is preserved in record_changes below.
    db.prepare(
      `DELETE FROM duplicate_flags WHERE family_a_id = ? OR family_b_id = ?`
    ).bind(discardId, discardId),
    db.prepare(`DELETE FROM families WHERE id = ?`).bind(discardId),
    db.prepare(
      `INSERT INTO record_changes (id, table_name, record_id, changed_by, changes) VALUES (?, 'families', ?, ?, ?)`
    ).bind(auditId, keepId, reviewerId, auditChanges),
  ]);
}
