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

  const keepPhone = (keep.phone as string | null) ?? null;

  // Enumerate every flag row the batch will delete (their NOT NULL FK forces
  // it) so the audit record preserves what was collaterally removed.
  const collateral = await db.prepare(
    `SELECT id FROM duplicate_flags WHERE (family_a_id = ? OR family_b_id = ?) AND id != ?`
  ).bind(discardId, discardId, flagId).all<{ id: string }>();

  // Same-date visits on BOTH families: the discard side is about to be
  // deleted, so capture its metadata now and back-fill keep's visits after the
  // delete (running it before would duplicate idempotency_key under its
  // unique index and abort the batch).
  const collided = await db.prepare(`
    SELECT id, visit_date, picked_up_by_phone, volunteer_id, updated_by, bag_received, idempotency_key
    FROM visits WHERE family_id = ?
    AND visit_date IN (SELECT visit_date FROM visits WHERE family_id = ?)
  `).bind(discardId, keepId).all<{
    id: string; visit_date: string; picked_up_by_phone: string | null; volunteer_id: string | null;
    updated_by: string | null; bag_received: number; idempotency_key: string | null;
  }>();

  // Exactly ONE deterministic keep-side target per collided date — updating
  // by (family_id, visit_date) could match several rows and copy the same
  // idempotency_key onto all of them, violating its unique index.
  const keepTargets = await db.prepare(`
    SELECT v.id, v.visit_date, v.idempotency_key FROM visits v
    WHERE v.family_id = ?1
    AND v.visit_date IN (SELECT visit_date FROM visits WHERE family_id = ?2)
    AND v.id = (SELECT MIN(id) FROM visits WHERE family_id = ?1 AND visit_date = v.visit_date)
  `).bind(keepId, discardId).all<{ id: string; visit_date: string; idempotency_key: string | null }>();
  const targetByDate = new Map((keepTargets.results ?? []).map(t => [t.visit_date, t]));

  // Group the discarded rows per date: first non-null value per field wins;
  // bag ORs across all rows. One discard key may be ADOPTED onto a keep
  // target that has none; every other discarded key becomes a merged_keys
  // alias so offline replays resolve to the surviving visit.
  const byDate = new Map<string, typeof collided.results>();
  for (const v of (collided.results ?? [])) {
    const arr = byDate.get(v.visit_date) ?? [];
    arr.push(v);
    byDate.set(v.visit_date, arr);
  }
  const backfills: { date: string; targetId: string; phone: string | null; vol: string | null; upd: string | null; key: string | null; bag: number }[] = [];
  const visitAliases: { key: string; targetId: string }[] = [];
  // Aliases created by EARLIER merges may point at visit ids this merge is
  // about to delete — they must be redirected to the new survivors, or a
  // chained merge (A→B→C) leaves replays resolving to deleted records.
  const visitRetargets: { deletedId: string; newTargetId: string }[] = [];
  for (const [date, rows] of byDate) {
    const target = targetByDate.get(date);
    if (!target || !rows) {
      throw new Error(`merge invariant broken: no keep-side target for collided date ${date}`);
    }
    for (const r of rows) visitRetargets.push({ deletedId: r.id, newTargetId: target.id });
    const first = <T>(f: (r: NonNullable<typeof collided.results>[number]) => T | null) =>
      rows.map(f).find(v => v !== null) ?? null;
    const keys = rows.map(r => r.idempotency_key).filter((k): k is string => k !== null);
    let adoptKey: string | null = null;
    if (target.idempotency_key === null && keys.length > 0) {
      adoptKey = keys[0];
      for (const k of keys.slice(1)) visitAliases.push({ key: k, targetId: target.id });
    } else {
      for (const k of keys) visitAliases.push({ key: k, targetId: target.id });
    }
    backfills.push({
      date,
      targetId: target.id,
      phone: first(r => r.picked_up_by_phone),
      vol: first(r => r.volunteer_id),
      upd: first(r => r.updated_by),
      key: adoptKey,
      bag: rows.some(r => r.bag_received === 1) ? 1 : 0,
    });
  }

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
    // Back-fill metadata from the deleted same-date visits onto ONE keep
    // visit per date: null fields adopt the discarded value, bag_received ORs.
    ...backfills.map(b => db.prepare(`
      UPDATE visits SET
        picked_up_by_phone = COALESCE(picked_up_by_phone, ?),
        volunteer_id = COALESCE(volunteer_id, ?),
        updated_by = COALESCE(updated_by, ?),
        idempotency_key = COALESCE(idempotency_key, ?),
        bag_received = CASE WHEN bag_received = 1 OR ? = 1 THEN 1 ELSE 0 END
      WHERE id = ?
    `).bind(b.phone, b.vol, b.upd, b.key, b.bag, b.targetId)),
    // Idempotency aliases: replays of merged-away submissions must resolve to
    // the survivors, not re-create the duplicates this merge eliminated.
    ...(discard.idempotency_key ? [db.prepare(
      `INSERT OR IGNORE INTO merged_keys (idempotency_key, kind, target_id) VALUES (?, 'family', ?)`
    ).bind(discard.idempotency_key, keepId)] : []),
    ...visitAliases.map(a => db.prepare(
      `INSERT OR IGNORE INTO merged_keys (idempotency_key, kind, target_id) VALUES (?, 'visit', ?)`
    ).bind(a.key, a.targetId)),
    // Family-ID alias: offline directories cache the discarded id; replayed
    // visits against it must land on the survivor, not 500 on a missing FK.
    db.prepare(
      `INSERT OR REPLACE INTO merged_family_ids (old_id, target_id) VALUES (?, ?)`
    ).bind(discardId, keepId),
    // Chained merges: earlier old-ids pointing at the row THIS merge deletes
    // must follow the survivor (A→B then B→C leaves A→C).
    db.prepare(
      `UPDATE merged_family_ids SET target_id = ? WHERE target_id = ?`
    ).bind(keepId, discardId),
    // Chained-merge redirection: aliases from earlier merges that point at
    // records THIS merge deletes must follow the survivors.
    db.prepare(
      `UPDATE merged_keys SET target_id = ? WHERE kind = 'family' AND target_id = ?`
    ).bind(keepId, discardId),
    ...visitRetargets.map(r => db.prepare(
      `UPDATE merged_keys SET target_id = ? WHERE kind = 'visit' AND target_id = ?`
    ).bind(r.newTargetId, r.deletedId)),
    // Move proxies whose phone isn't already on keep; leftovers are dupes.
    // A discard-side proxy phone equal to KEEP's own phone is left behind
    // (and deleted below) rather than moved — merging two registrations of
    // the same household must not turn keep into its own proxy.
    db.prepare(`
      UPDATE proxies SET family_id = ?
      WHERE family_id = ?
      AND (proxy_phone IS NULL OR proxy_phone NOT IN (
        SELECT proxy_phone FROM proxies WHERE family_id = ? AND proxy_phone IS NOT NULL
      ))
      ${keepPhone !== null ? 'AND proxy_phone IS NOT ?' : ''}
    `).bind(...(keepPhone !== null ? [keepId, discardId, keepId, keepPhone] : [keepId, discardId, keepId])),
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
