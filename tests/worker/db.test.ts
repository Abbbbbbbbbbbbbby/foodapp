import { env } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  insertFamily,
  getFamilyById,
  searchFamilies,
  getFamiliesForPickup,
  insertVisit,
  getVisitsByFamily,
} from '../../src/worker/db';
import type { Env } from '../../src/worker/schema';

beforeEach(async () => {
  const db = (env as unknown as Env).DB;
  await db.exec(`
    DELETE FROM visits; DELETE FROM proxies;
    DELETE FROM families; DELETE FROM users; DELETE FROM otp_codes;
  `);
});

describe('insertFamily + getFamilyById', () => {
  it('inserts a family and retrieves it by id', async () => {
    const db = (env as unknown as Env).DB;
    const { id } = await insertFamily(db, {
      name: 'Gonzalez Family',
      phone: '4805551234',
      address: null,
      zip_code: '85001',
      date_of_birth: null,
      language: 'es',
      ethnicity: null,
      hispanic: 'yes',
      ami_bracket: '<30%',
      num_people: 4,
      num_children_under_18: 2,
      num_children_under_5: 1,
      num_with_diabetes: null,
      health_insurance: 'no',
      snap_benefits: 'yes',
      receives_texts: true,
      want_text_updates: true,
      id_confirmed: true,
      bag_received: false,
      first_visit_date: '2026-05-20',
      created_by: null,
    });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const family = await getFamilyById(db, id);
    expect(family).not.toBeNull();
    expect(family!.name).toBe('Gonzalez Family');
    expect(family!.phone).toBe('4805551234');
    expect(family!.ami_bracket).toBe('<30%');
  });
});

describe('searchFamilies', () => {
  it('finds a family by exact phone', async () => {
    const db = (env as unknown as Env).DB;
    await insertFamily(db, {
      name: 'Garcia Family', phone: '6025550101',
      address: null, zip_code: null, date_of_birth: null, language: null,
      ethnicity: null, hispanic: null, ami_bracket: null, num_people: 3,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null,
      want_text_updates: null, id_confirmed: null, bag_received: null,
      first_visit_date: null, created_by: null,
    });
    const results = await searchFamilies(db, { phone: '6025550101' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Garcia Family');
  });

  it('finds a family by fuzzy name match', async () => {
    const db = (env as unknown as Env).DB;
    await insertFamily(db, {
      name: 'Gonzalez Family', phone: null,
      address: null, zip_code: null, date_of_birth: null, language: null,
      ethnicity: null, hispanic: null, ami_bracket: null, num_people: 2,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null,
      want_text_updates: null, id_confirmed: null, bag_received: null,
      first_visit_date: null, created_by: null,
    });
    const results = await searchFamilies(db, { name: 'Gonzales' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Gonzalez Family');
  });

  it('returns empty array when nothing matches', async () => {
    const db = (env as unknown as Env).DB;
    const results = await searchFamilies(db, { name: 'Zzyzx' });
    expect(results).toHaveLength(0);
  });
});

describe('getFamiliesForPickup', () => {
  it('returns own family and proxy families for a phone number', async () => {
    const db = (env as unknown as Env).DB;

    const { id: ownId } = await insertFamily(db, {
      name: 'Mendez Family', phone: '4805559999',
      address: null, zip_code: null, date_of_birth: null, language: null,
      ethnicity: null, hispanic: null, ami_bracket: null, num_people: 3,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null,
      want_text_updates: null, id_confirmed: null, bag_received: null,
      first_visit_date: null, created_by: null,
    });

    const { id: proxyFamilyId } = await insertFamily(db, {
      name: 'Vargas Family', phone: '6025558888',
      address: null, zip_code: null, date_of_birth: null, language: null,
      ethnicity: null, hispanic: null, ami_bracket: null, num_people: 5,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null,
      want_text_updates: null, id_confirmed: null, bag_received: null,
      first_visit_date: null, created_by: null,
    });

    await db.prepare(
      `INSERT INTO proxies (family_id, proxy_name, proxy_phone) VALUES (?, ?, ?)`
    ).bind(proxyFamilyId, 'Rosa Mendez', '4805559999').run();

    const { own, proxy } = await getFamiliesForPickup(db, '4805559999');
    expect(own).not.toBeNull();
    expect(own!.id).toBe(ownId);
    expect(proxy).toHaveLength(1);
    expect(proxy[0].id).toBe(proxyFamilyId);
  });
});

describe('insertFamily idempotency', () => {
  it('returns the same id when the same idempotency_key is submitted twice', async () => {
    const db = (env as unknown as Env).DB;
    const data = {
      name: 'Idempotent Family', phone: null, address: null, zip_code: null,
      date_of_birth: null, language: null, ethnicity: null, hispanic: null,
      ami_bracket: null, num_people: 2, num_children_under_18: null,
      num_children_under_5: null, num_with_diabetes: null, health_insurance: null,
      snap_benefits: null, receives_texts: null, want_text_updates: null,
      id_confirmed: null, bag_received: null, first_visit_date: null, created_by: null,
    };
    const { id: id1, created: created1 } = await insertFamily(db, data, 'idem-key-001');
    const { id: id2, created: created2 } = await insertFamily(db, data, 'idem-key-001');
    expect(id1).toBe(id2);
  });

  it('creates a distinct record when no idempotency_key is provided', async () => {
    const db = (env as unknown as Env).DB;
    const data = {
      name: 'Duplicate Name', phone: null, address: null, zip_code: null,
      date_of_birth: null, language: null, ethnicity: null, hispanic: null,
      ami_bracket: null, num_people: 1, num_children_under_18: null,
      num_children_under_5: null, num_with_diabetes: null, health_insurance: null,
      snap_benefits: null, receives_texts: null, want_text_updates: null,
      id_confirmed: null, bag_received: null, first_visit_date: null, created_by: null,
    };
    const { id: id1 } = await insertFamily(db, data);
    const { id: id2 } = await insertFamily(db, data);
    expect(id1).not.toBe(id2);
  });
});

describe('insertVisit idempotency', () => {
  it('returns the same id when the same idempotency_key is submitted twice', async () => {
    const db = (env as unknown as Env).DB;
    const { id: familyId } = await insertFamily(db, {
      name: 'Visit Idem Family', phone: null, address: null, zip_code: null,
      date_of_birth: null, language: null, ethnicity: null, hispanic: null,
      ami_bracket: null, num_people: 1, num_children_under_18: null,
      num_children_under_5: null, num_with_diabetes: null, health_insurance: null,
      snap_benefits: null, receives_texts: null, want_text_updates: null,
      id_confirmed: null, bag_received: null, first_visit_date: null, created_by: null,
    });
    const visitData = { family_id: familyId, visit_date: '2026-07-22', picked_up_by_phone: null, volunteer_id: null };
    const { id: vid1 } = await insertVisit(db, visitData, 'visit-idem-001');
    const { id: vid2 } = await insertVisit(db, visitData, 'visit-idem-001');
    expect(vid1).toBe(vid2);
  });
});

describe('insertVisit + getVisitsByFamily', () => {
  it('logs a visit and retrieves it', async () => {
    const db = (env as unknown as Env).DB;
    const { id: familyId } = await insertFamily(db, {
      name: 'Test Family', phone: null,
      address: null, zip_code: null, date_of_birth: null, language: null,
      ethnicity: null, hispanic: null, ami_bracket: null, num_people: 2,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null,
      want_text_updates: null, id_confirmed: null, bag_received: null,
      first_visit_date: null, created_by: null,
    });

    await insertVisit(db, {
      family_id: familyId,
      visit_date: '2026-05-20',
      picked_up_by_phone: null,
      volunteer_id: null,
    });

    const visits = await getVisitsByFamily(db, familyId);
    expect(visits).toHaveLength(1);
    expect(visits[0].visit_date).toBe('2026-05-20');
  });
});

function baseFamily() {
  return {
    name: 'X', phone: null, address: null, zip_code: null, date_of_birth: null,
    language: null, ethnicity: null, hispanic: null, ami_bracket: null, num_people: null,
    num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
    health_insurance: null, snap_benefits: null, receives_texts: null, want_text_updates: null,
    id_confirmed: null, bag_received: null, first_visit_date: null, created_by: null,
  };
}

describe('searchFamilies — broadened fuzzy matching (issue #6)', () => {
  it('finds a transposed first name (Smiht → Smith)', async () => {
    const db = (env as unknown as Env).DB;
    await insertFamily(db, { ...baseFamily(), name: 'Smith Family' });
    const results = await searchFamilies(db, { name: 'Smiht' });
    expect(results.some(r => r.name === 'Smith Family')).toBe(true);
  });

  it('finds a LEADING-pair transposition (Msith → Smith)', async () => {
    const db = (env as unknown as Env).DB;
    await insertFamily(db, { ...baseFamily(), name: 'Smith Family' });
    const results = await searchFamilies(db, { name: 'Msith' });
    expect(results.some(r => r.name === 'Smith Family')).toBe(true);
  });

  it('finds ANY single-edit typo (Sxith → Smith): the distance contract holds with no prefilter escape hatch', async () => {
    const db = (env as unknown as Env).DB;
    await insertFamily(db, { ...baseFamily(), name: 'Smith Family' });
    // Position-1 substitution defeated every finite bigram-needle scheme;
    // the full-scan Levenshtein pass is what guarantees this.
    const results = await searchFamilies(db, { name: 'Sxith' });
    expect(results.some(r => r.name === 'Smith Family')).toBe(true);
  });

  it('finds a family by a NON-first token (last-name search)', async () => {
    const db = (env as unknown as Env).DB;
    await insertFamily(db, { ...baseFamily(), name: 'Jose Garcia' });
    const results = await searchFamilies(db, { name: 'Garcia' });
    expect(results.some(r => r.name === 'Jose Garcia')).toBe(true);
  });

  it('still excludes clearly unrelated names', async () => {
    const db = (env as unknown as Env).DB;
    await insertFamily(db, { ...baseFamily(), name: 'Zhang Wei' });
    const results = await searchFamilies(db, { name: 'Garcia' });
    expect(results.some(r => r.name === 'Zhang Wei')).toBe(false);
  });

  it('finds the real match even when the bigram matches more than the 300-row cap', async () => {
    const db = (env as unknown as Env).DB;
    // 305 decoys all containing the bigram 'ma' (but not starting with it).
    // Ids are pinned so every decoy sorts BEFORE the target: the unranked
    // query emitted rows in id order, so truncation deterministically
    // returned only decoys and dropped the family being checked in.
    const stmt = db.prepare('INSERT INTO families (id, name, name_normalized) VALUES (?, ?, ?)');
    for (let batch = 0; batch < 5; batch++) {
      await db.batch(Array.from({ length: 61 }, (_, i) => {
        const n = batch * 61 + i;
        const id = `${String(n).padStart(4, '0')}${'0'.repeat(28)}`;
        return stmt.bind(id, `Amanda D${n}`, `amanda d${n}`);
      }));
    }
    await stmt.bind('f'.repeat(32), 'Martinez Family', 'martinez family').run();
    // Last-name-only variant: 'jose martinez' does NOT start with 'ma', so
    // only the any-token-start rank tier keeps it inside the cap.
    await stmt.bind('e'.repeat(32), 'Jose Martinez', 'jose martinez').run();

    // Exact token: ranked into the cap by the full-token substring tier.
    const exact = await searchFamilies(db, { name: 'Martinez' });
    expect(exact.some(r => r.name === 'Martinez Family')).toBe(true);
    expect(exact.some(r => r.name === 'Jose Martinez')).toBe(true);

    // Misspelled token: no substring match, but the token-start tier still
    // ranks both above the mid-word decoys.
    const fuzzy = await searchFamilies(db, { name: 'Martines' });
    expect(fuzzy.some(r => r.name === 'Martinez Family')).toBe(true);
    expect(fuzzy.some(r => r.name === 'Jose Martinez')).toBe(true);
  });

  it('applies the tighter distance threshold to short tokens', async () => {
    const db = (env as unknown as Env).DB;
    await insertFamily(db, { ...baseFamily(), name: 'Monaxyz Family' });
    await insertFamily(db, { ...baseFamily(), name: 'Monaxyzq Family' });

    // 4-char token → threshold 2: distance-3 'monaxyz' must NOT match.
    const short = await searchFamilies(db, { name: 'Mona' });
    expect(short.some(r => r.name === 'Monaxyz Family')).toBe(false);

    // 5-char token → threshold 3: distance-3 'monaxyzq' MUST match.
    const long = await searchFamilies(db, { name: 'Monax' });
    expect(long.some(r => r.name === 'Monaxyzq Family')).toBe(true);
  });
});
