import { env } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { mergeFamilies, checkForDuplicates } from '../../src/worker/duplicates';

async function insertFamily(id: string, name: string, phone: string | null, extra: Record<string, unknown> = {}) {
  const cols = ['id', 'name', 'phone', ...Object.keys(extra)];
  const vals = [id, name, phone, ...Object.values(extra)];
  await env.DB.prepare(
    `INSERT INTO families (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...vals).run();
}

async function insertVisit(id: string, familyId: string, date: string, extra: Record<string, unknown> = {}) {
  const cols = ['id', 'family_id', 'visit_date', ...Object.keys(extra)];
  const vals = [id, familyId, date, ...Object.values(extra)];
  await env.DB.prepare(
    `INSERT INTO visits (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
  ).bind(...vals).run();
}

async function insertFlag(id: string, a: string, b: string) {
  const [fa, fb] = a < b ? [a, b] : [b, a];
  await env.DB.prepare(
    `INSERT INTO duplicate_flags (id, family_a_id, family_b_id, reason) VALUES (?, ?, ?, 'phone')`
  ).bind(id, fa, fb).run();
}

const USER_ID = 'merge-test-user';

describe('mergeFamilies', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM duplicate_flags`),
      env.DB.prepare(`DELETE FROM visits`),
      env.DB.prepare(`DELETE FROM proxies`),
      env.DB.prepare(`DELETE FROM families`),
      env.DB.prepare(`DELETE FROM record_changes`),
    ]);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered) VALUES (?, 'Merge Tester', '4805550000', 'admin', 1, 0)`
    ).bind(USER_ID).run();
  });

  it('merges with a referencing flag present — no FK failure, flag rows removed, audit written', async () => {
    await insertFamily('fam-keep', 'Garcia Family', '4805551111');
    await insertFamily('fam-drop', 'Garcia Familia', '4805551111');
    await insertFlag('flag-1', 'fam-keep', 'fam-drop');

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-1');

    const dropped = await env.DB.prepare(`SELECT id FROM families WHERE id = 'fam-drop'`).first();
    expect(dropped).toBeNull();
    const flags = await env.DB.prepare(`SELECT COUNT(*) AS n FROM duplicate_flags`).first<{ n: number }>();
    expect(flags!.n).toBe(0);
    const audit = await env.DB.prepare(
      `SELECT changes FROM record_changes WHERE table_name = 'families' AND record_id = 'fam-keep'`
    ).first<{ changes: string }>();
    expect(audit).not.toBeNull();
    expect(JSON.parse(audit!.changes).merged_from.id).toBe('fam-drop');
  });

  it('moves visits preserving bag_received and idempotency_key', async () => {
    await insertFamily('fam-keep', 'A', '4805551111');
    await insertFamily('fam-drop', 'B', '4805552222');
    await insertFlag('flag-1', 'fam-keep', 'fam-drop');
    await insertVisit('v-1', 'fam-drop', '2026-07-01', { bag_received: 1, idempotency_key: 'key-abc' });

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-1');

    const moved = await env.DB.prepare(
      `SELECT id, family_id, bag_received, idempotency_key FROM visits WHERE idempotency_key = 'key-abc'`
    ).first<{ id: string; family_id: string; bag_received: number; idempotency_key: string }>();
    expect(moved).not.toBeNull();
    expect(moved!.family_id).toBe('fam-keep');
    expect(moved!.bag_received).toBe(1);
    expect(moved!.id).toBe('v-1'); // moved, not copied
  });

  it('drops same-date duplicate visits and keeps distinct dates', async () => {
    await insertFamily('fam-keep', 'A', '4805551111');
    await insertFamily('fam-drop', 'B', '4805552222');
    await insertFlag('flag-1', 'fam-keep', 'fam-drop');
    await insertVisit('v-keep', 'fam-keep', '2026-07-01');
    await insertVisit('v-dupe', 'fam-drop', '2026-07-01');
    await insertVisit('v-new', 'fam-drop', '2026-07-08');

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-1');

    const rows = await env.DB.prepare(
      `SELECT id FROM visits WHERE family_id = 'fam-keep' ORDER BY visit_date`
    ).all<{ id: string }>();
    expect(rows.results!.map(r => r.id)).toEqual(['v-keep', 'v-new']);
    const orphans = await env.DB.prepare(`SELECT COUNT(*) AS n FROM visits WHERE family_id = 'fam-drop'`).first<{ n: number }>();
    expect(orphans!.n).toBe(0);
  });

  it('removes other flags referencing the discard family but keeps unrelated pending flags', async () => {
    await insertFamily('fam-keep', 'A', '4805551111');
    await insertFamily('fam-drop', 'B', '4805552222');
    await insertFamily('fam-other', 'C', '4805553333');
    await insertFlag('flag-main', 'fam-keep', 'fam-drop');
    await insertFlag('flag-side', 'fam-drop', 'fam-other');
    await insertFlag('flag-unrelated', 'fam-keep', 'fam-other');

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-main');

    const remaining = await env.DB.prepare(`SELECT id FROM duplicate_flags`).all<{ id: string }>();
    expect(remaining.results!.map(r => r.id)).toEqual(['flag-unrelated']);
  });

  it('fills null fields on keep from discard', async () => {
    await insertFamily('fam-keep', 'A', '4805551111');
    await insertFamily('fam-drop', 'B', '4805552222', { zip_code: '85001', num_people: 4 });
    await insertFlag('flag-1', 'fam-keep', 'fam-drop');

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-1');

    const keep = await env.DB.prepare(`SELECT zip_code, num_people, phone FROM families WHERE id = 'fam-keep'`)
      .first<{ zip_code: string; num_people: number; phone: string }>();
    expect(keep!.zip_code).toBe('85001');
    expect(keep!.num_people).toBe(4);
    expect(keep!.phone).toBe('4805551111'); // not overwritten
  });
});

describe('checkForDuplicates', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM duplicate_flags`),
      env.DB.prepare(`DELETE FROM families`),
    ]);
  });

  it('flags same-phone families once with normalized pair order', async () => {
    await insertFamily('fam-b', 'Lopez', '4805559999');
    await insertFamily('fam-a', 'Lopez Jr', '4805559999');
    await checkForDuplicates(env.DB, 'fam-a', 'Lopez Jr', '4805559999');
    const flags = await env.DB.prepare(`SELECT family_a_id, family_b_id, reason FROM duplicate_flags`).all();
    expect(flags.results!.length).toBe(1);
    expect(flags.results![0]).toMatchObject({ family_a_id: 'fam-a', family_b_id: 'fam-b', reason: 'phone' });
  });
});

describe('mergeFamilies — review-round regressions', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM duplicate_flags`),
      env.DB.prepare(`DELETE FROM visits`),
      env.DB.prepare(`DELETE FROM proxies`),
      env.DB.prepare(`DELETE FROM families`),
      env.DB.prepare(`DELETE FROM record_changes`),
    ]);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered) VALUES (?, 'Merge Tester', '4805550000', 'admin', 1, 0)`
    ).bind(USER_ID).run();
  });

  it('same-date merge propagates bag_received=1 from the discarded visit', async () => {
    await insertFamily('fam-keep', 'A', '4805551111');
    await insertFamily('fam-drop', 'B', '4805552222');
    await insertFlag('flag-1', 'fam-keep', 'fam-drop');
    await insertVisit('v-keep', 'fam-keep', '2026-08-01', { bag_received: 0 });
    await insertVisit('v-drop', 'fam-drop', '2026-08-01', { bag_received: 1 });

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-1');

    const kept = await env.DB.prepare(
      `SELECT bag_received FROM visits WHERE id = 'v-keep'`
    ).first<{ bag_received: number }>();
    expect(kept!.bag_received).toBe(1); // bag data survived the same-date dedup
  });
});

describe('mergeFamilies — same-date metadata preservation (probe round 2)', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM duplicate_flags`),
      env.DB.prepare(`DELETE FROM visits`),
      env.DB.prepare(`DELETE FROM proxies`),
      env.DB.prepare(`DELETE FROM families`),
      env.DB.prepare(`DELETE FROM record_changes`),
    ]);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered) VALUES (?, 'Merge Tester', '4805550000', 'admin', 1, 0)`
    ).bind(USER_ID).run();
  });

  it('back-fills picked_up_by_phone, volunteer_id, and idempotency_key from the discarded same-date visit', async () => {
    await insertFamily('fam-keep', 'A', '4805551111');
    await insertFamily('fam-drop', 'B', '4805552222');
    await insertFlag('flag-1', 'fam-keep', 'fam-drop');
    await insertVisit('v-keep', 'fam-keep', '2026-08-02', { bag_received: 0 });
    await insertVisit('v-drop', 'fam-drop', '2026-08-02', {
      bag_received: 1, picked_up_by_phone: '4805559876', volunteer_id: USER_ID, idempotency_key: 'k-meta',
    });

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-1');

    const kept = await env.DB.prepare(
      `SELECT picked_up_by_phone, volunteer_id, idempotency_key, bag_received FROM visits WHERE id = 'v-keep'`
    ).first<{ picked_up_by_phone: string | null; volunteer_id: string | null; idempotency_key: string | null; bag_received: number }>();
    expect(kept!.picked_up_by_phone).toBe('4805559876');
    expect(kept!.volunteer_id).toBe(USER_ID);
    expect(kept!.idempotency_key).toBe('k-meta'); // replay of the old submission dedupes
    expect(kept!.bag_received).toBe(1);
  });

  it('does not overwrite keep-side values that already exist', async () => {
    await insertFamily('fam-keep', 'A', '4805551111');
    await insertFamily('fam-drop', 'B', '4805552222');
    await insertFlag('flag-1', 'fam-keep', 'fam-drop');
    await insertVisit('v-keep', 'fam-keep', '2026-08-02', { picked_up_by_phone: '4805550001', idempotency_key: 'k-keep' });
    await insertVisit('v-drop', 'fam-drop', '2026-08-02', { picked_up_by_phone: '4805559876', idempotency_key: 'k-drop' });

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-1');

    const kept = await env.DB.prepare(
      `SELECT picked_up_by_phone, idempotency_key FROM visits WHERE id = 'v-keep'`
    ).first<{ picked_up_by_phone: string; idempotency_key: string }>();
    expect(kept!.picked_up_by_phone).toBe('4805550001');
    expect(kept!.idempotency_key).toBe('k-keep');
  });
});

describe('mergeFamilies — probe round 3: multi-visit collision + replay aliases', () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM merged_keys`),
      env.DB.prepare(`DELETE FROM duplicate_flags`),
      env.DB.prepare(`DELETE FROM visits`),
      env.DB.prepare(`DELETE FROM proxies`),
      env.DB.prepare(`DELETE FROM families`),
      env.DB.prepare(`DELETE FROM record_changes`),
    ]);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered) VALUES (?, 'Merge Tester', '4805550000', 'admin', 1, 0)`
    ).bind(USER_ID).run();
  });

  it('merge succeeds when keep has MULTIPLE visits on the collided date (key lands on exactly one)', async () => {
    await insertFamily('fam-keep', 'A', '4805551111');
    await insertFamily('fam-drop', 'B', '4805552222');
    await insertFlag('flag-1', 'fam-keep', 'fam-drop');
    await insertVisit('v-keep-a', 'fam-keep', '2026-08-03');
    await insertVisit('v-keep-b', 'fam-keep', '2026-08-03');
    await insertVisit('v-drop', 'fam-drop', '2026-08-03', { idempotency_key: 'k-multi' });

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-1');

    const withKey = await env.DB.prepare(
      `SELECT id FROM visits WHERE idempotency_key = 'k-multi'`
    ).all<{ id: string }>();
    expect(withKey.results!.length).toBe(1);
    expect(withKey.results![0].id).toBe('v-keep-a'); // deterministic MIN(id) target
  });

  it('replaying the merged-away FAMILY key resolves to the surviving family', async () => {
    const { insertFamily: dbInsertFamily } = await import('../../src/worker/db');
    await insertFamily('fam-keep', 'Garcia', '4805551111');
    await env.DB.prepare(
      `INSERT INTO families (id, name, phone, idempotency_key) VALUES ('fam-drop', 'Garcia Dup', '4805553333', 'family-drop-key')`
    ).run();
    await insertFlag('flag-1', 'fam-keep', 'fam-drop');

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-1');

    const replayId = await dbInsertFamily(env.DB, {
      name: 'Garcia Dup', phone: null, address: null, zip_code: null, date_of_birth: null,
      language: null, ethnicity: null, hispanic: null, ami_bracket: null, num_people: null,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null, want_text_updates: null,
      id_confirmed: null, bag_received: null, first_visit_date: null, created_by: USER_ID,
    }, 'family-drop-key');

    expect(replayId).toBe('fam-keep'); // resolved to survivor, no duplicate created
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM families`).first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it('replaying a merged-away VISIT key (both sides had keys) resolves to the surviving visit', async () => {
    const { insertVisit: dbInsertVisit } = await import('../../src/worker/db');
    await insertFamily('fam-keep', 'A', '4805551111');
    await insertFamily('fam-drop', 'B', '4805552222');
    await insertFlag('flag-1', 'fam-keep', 'fam-drop');
    await insertVisit('v-keep', 'fam-keep', '2026-08-04', { idempotency_key: 'k-keep' });
    await insertVisit('v-drop', 'fam-drop', '2026-08-04', { idempotency_key: 'k-drop' });

    await mergeFamilies(env.DB, 'fam-keep', 'fam-drop', USER_ID, 'flag-1');

    const replayId = await dbInsertVisit(env.DB, {
      family_id: 'fam-keep', visit_date: '2026-08-04', picked_up_by_phone: null,
      volunteer_id: USER_ID, bag_received: null,
    }, 'k-drop');

    expect(replayId).toBe('v-keep'); // alias hit — no duplicate visit
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM visits`).first<{ n: number }>();
    expect(count!.n).toBe(1);
  });
});
