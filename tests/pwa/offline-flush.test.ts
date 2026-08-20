import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  queueItem, getPending, getDeadLetters, clearDeadLetters, flushQueue, DB_VERSION,
} from '../../src/pwa/lib/offline';

class FakeApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Clear both stores rather than deleteDatabase(): offline.ts opens a fresh
// connection per operation and never closes them, so deleteDatabase blocks
// forever on the still-open handles.
function freshDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('foodapp_offline', DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('dead-letter')) db.createObjectStore('dead-letter', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('directory')) db.createObjectStore('directory', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('telemetry')) db.createObjectStore('telemetry', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'user_id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(['pending', 'dead-letter'], 'readwrite');
      tx.objectStore('pending').clear();
      tx.objectStore('dead-letter').clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    req.onerror = () => reject(req.error);
  });
}

const FAMILY_PAYLOAD = {
  data: { name: 'Test Family', num_people: 3 },
  proxyData: null,
};

describe('flushQueue — dead-letter contract (durable IDB)', () => {
  beforeEach(async () => {
    await freshDb();
  });

  it('4xx: dead-letters WITH full payload and idempotency key, removes from pending', async () => {
    await queueItem({ type: 'family', payload: FAMILY_PAYLOAD }, 'key-123');
    const result = await flushQueue(async () => { throw new FakeApiError(400, 'hispanic must be one of...'); });

    expect(result.deadLettered).toBe(1);
    expect(result.errors).toBe(0);
    expect(await getPending()).toHaveLength(0);

    const dls = await getDeadLetters();
    expect(dls).toHaveLength(1);
    expect(dls[0].errorStatus).toBe(400);
    expect(dls[0].payload).toEqual(FAMILY_PAYLOAD); // recoverable copy
    expect(dls[0].idempotencyKey).toBe('key-123');  // replay-safe
    expect(dls[0].label).toBe('Test Family');
  });

  it('5xx: keeps the item in pending, no dead letter', async () => {
    await queueItem({ type: 'family', payload: FAMILY_PAYLOAD });
    const result = await flushQueue(async () => { throw new FakeApiError(500, 'boom'); });

    expect(result.errors).toBe(1);
    expect(result.deadLettered).toBe(0);
    expect(await getPending()).toHaveLength(1);
    expect(await getDeadLetters()).toHaveLength(0);
  });

  it('401: keeps the item, flags re-login, no dead letter', async () => {
    await queueItem({ type: 'family', payload: FAMILY_PAYLOAD });
    const result = await flushQueue(async () => { throw new FakeApiError(401, 'Unauthorized'); });

    expect(result.needsReLogin).toBe(true);
    expect(result.deadLettered).toBe(0);
    expect(await getPending()).toHaveLength(1);
    expect(await getDeadLetters()).toHaveLength(0);
  });

  it('network error (TypeError): keeps the item for retry', async () => {
    await queueItem({ type: 'family', payload: FAMILY_PAYLOAD });
    const result = await flushQueue(async () => { throw new TypeError('Failed to fetch'); });

    expect(result.errors).toBe(1);
    expect(await getPending()).toHaveLength(1);
  });

  it('partial classification: 400 item dead-letters while 500 item stays queued', async () => {
    await queueItem({ type: 'family', payload: { data: { name: 'Rejected' }, proxyData: null } }, 'k-reject');
    await queueItem({ type: 'family', payload: { data: { name: 'Transient' }, proxyData: null } }, 'k-retry');

    const result = await flushQueue(async (_url, body) => {
      const b = body as { idempotency_key?: string };
      if (b.idempotency_key === 'k-reject') throw new FakeApiError(422, 'bad data');
      throw new FakeApiError(503, 'try later');
    });

    expect(result.deadLettered).toBe(1);
    expect(result.errors).toBe(1);
    const pending = await getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].idempotencyKey).toBe('k-retry');
    const dls = await getDeadLetters();
    expect(dls).toHaveLength(1);
    expect(dls[0].label).toBe('Rejected');
  });

  it('clearDeadLetters empties the store (acknowledge flow)', async () => {
    await queueItem({ type: 'family', payload: FAMILY_PAYLOAD });
    await flushQueue(async () => { throw new FakeApiError(400, 'nope'); });
    expect(await getDeadLetters()).toHaveLength(1);

    await clearDeadLetters();
    expect(await getDeadLetters()).toHaveLength(0);
  });

  it('bag allocated offline is applied to the synced visit via PATCH', async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const { setItemBag } = await import('../../src/pwa/lib/offline');
    const queueId = await queueItem({ type: 'family', payload: FAMILY_PAYLOAD }, 'key-bag');
    await setItemBag(queueId, true);

    const result = await flushQueue(async (url, _body, method) => {
      calls.push({ url, method });
      return { id: url === '/api/families' ? 'fam-9' : 'visit-9' };
    });

    expect(result.flushed).toBe(1);
    expect(calls).toEqual([
      { url: '/api/families', method: undefined },
      { url: '/api/visits', method: undefined },
      { url: '/api/visits/visit-9/bag', method: 'PATCH' },
    ]);
  });

  it('successful sync flushes family then visit with derived key', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    await queueItem({ type: 'family', payload: FAMILY_PAYLOAD }, 'key-ok');
    const result = await flushQueue(async (url, body) => {
      calls.push({ url, body: body as Record<string, unknown> });
      return { id: 'fam-1' };
    });

    expect(result.flushed).toBe(1);
    expect(await getPending()).toHaveLength(0);
    expect(calls.map(c => c.url)).toEqual(['/api/families', '/api/visits']);
    expect(calls[0].body.idempotency_key).toBe('key-ok');
    expect(calls[1].body.idempotency_key).toBe('key-ok-visit');
  });
});

describe('flushQueue — review-round regressions', () => {
  beforeEach(async () => {
    await freshDb();
  });

  it('a bag set during an active flush is still applied (fresh re-read before removal)', async () => {
    const { setItemBag } = await import('../../src/pwa/lib/offline');
    const queueId = await queueItem({ type: 'family', payload: FAMILY_PAYLOAD }, 'key-race');

    const calls: Array<{ url: string; method?: string }> = [];
    let releaseVisit!: () => void;
    const visitGate = new Promise<void>(r => { releaseVisit = r; });

    const flushP = flushQueue(async (url, _body, method) => {
      calls.push({ url, method });
      if (url === '/api/visits') {
        // Simulate the volunteer tapping "Save bags" while this item syncs
        await setItemBag(queueId, true);
        releaseVisit();
        return { id: 'visit-race' };
      }
      return { id: 'fam-race' };
    });

    await visitGate;
    const result = await flushP;

    expect(result.flushed).toBe(1);
    expect(calls.some(c => c.url === '/api/visits/visit-race/bag' && c.method === 'PATCH')).toBe(true);
    expect(await getPending()).toHaveLength(0);
  });

  it('an online trigger during an active flush schedules a trailing pass', async () => {
    await queueItem({ type: 'family', payload: { data: { name: 'First' }, proxyData: null } }, 'k-first');

    let queuedSecond = false;
    const flushP = flushQueue(async (url) => {
      if (!queuedSecond && url === '/api/families') {
        queuedSecond = true;
        // Second item lands mid-flush; the overlapping trigger must not be dropped
        await queueItem({ type: 'family', payload: { data: { name: 'Second' }, proxyData: null } }, 'k-second');
        const overlapping = await flushQueue(async () => ({ id: 'x' }));
        expect(overlapping.flushed).toBe(0); // guard returns immediately...
      }
      return { id: 'fam-' + Math.random().toString(36).slice(2) };
    });

    const result = await flushP;
    // ...but the first flush runs a trailing pass and drains the second item.
    expect(result.flushed).toBe(2);
    expect(await getPending()).toHaveLength(0);
  });

  it('a 4xx on the CATCH-UP bag PATCH is classified as bag-only, not whole-submission', async () => {
    const { setItemBag, getDeadLetters: getDLs } = await import('../../src/pwa/lib/offline');
    const queueId = await queueItem({ type: 'family', payload: FAMILY_PAYLOAD }, 'key-race-4xx');

    const flushP = flushQueue(async (url, _body, method) => {
      if (method === 'PATCH') throw new FakeApiError(422, 'bag rejected');
      if (url === '/api/visits') {
        await setItemBag(queueId, true); // lands mid-sync → catch-up path
        return { id: 'visit-cu' };
      }
      return { id: 'fam-cu' };
    });
    const result = await flushP;

    expect(result.deadLettered).toBe(1);
    const dls = await getDLs();
    expect(dls).toHaveLength(1);
    // The annotated bag-only record — NOT a generic whole-submission failure
    expect(dls[0].errorMessage).toContain('family and visit SAVED');
    expect(await getPending()).toHaveLength(0);
  });
});

describe('flushQueue — shared-device attribution (issue #6)', () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("holds another user's items instead of flushing them under the current identity", async () => {
    await queueItem({ type: 'family', payload: { data: { name: 'Mine' }, proxyData: null } }, 'k-mine', 'user-a');
    await queueItem({ type: 'family', payload: { data: { name: 'Theirs' }, proxyData: null } }, 'k-theirs', 'user-b');

    const posted: string[] = [];
    const result = await flushQueue(async (_url, body) => {
      const b = body as { idempotency_key?: string };
      if (b.idempotency_key) posted.push(b.idempotency_key);
      return { id: 'x' };
    }, 'user-a');

    expect(result.flushed).toBe(1);
    expect(result.foreignItems).toBe(1);
    expect(posted).toContain('k-mine');
    expect(posted).not.toContain('k-theirs');
    const pending = await getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].queuedByUserId).toBe('user-b'); // held, not lost
  });

  it('legacy items without attribution still flush', async () => {
    await queueItem({ type: 'family', payload: { data: { name: 'Legacy' }, proxyData: null } }, 'k-legacy');
    const result = await flushQueue(async () => ({ id: 'x' }), 'user-a');
    expect(result.flushed).toBe(1);
    expect(result.foreignItems).toBe(0);
  });
});

describe('flushQueue — in-flight guard (issue #6 re-review)', () => {
  beforeEach(async () => {
    await freshDb();
  });

  it('a concurrent call returns skipped:true, distinguishable from a clean flush', async () => {
    await queueItem({ type: 'family', payload: { data: { name: 'Slow' }, proxyData: null } }, 'k-slow');

    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const first = flushQueue(async () => { await gate; return { id: 'x' }; });

    // While the first flush is blocked mid-item, a second trigger must not
    // report "queue is clean" — callers would clear warning banners on that.
    const second = await flushQueue(async () => ({ id: 'x' }));
    expect(second.skipped).toBe(true);
    expect(second.flushed).toBe(0);

    release();
    const result = await first;
    expect(result.skipped).toBeUndefined(); // a real flush is never marked skipped
    expect(result.flushed).toBe(1);
  });
});

describe('adoptForeignItems — stranded-entry recovery (deactivated owner)', () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("re-attributes another user's held items so they flush under the adopter", async () => {
    const { adoptForeignItems } = await import('../../src/pwa/lib/offline');
    await queueItem({ type: 'family', payload: { data: { name: 'Stranded' }, proxyData: null } }, 'k-stranded', 'deactivated-user');
    await queueItem({ type: 'family', payload: { data: { name: 'Mine' }, proxyData: null } }, 'k-mine2', 'user-a');

    // Held while attributed to someone else…
    const before = await flushQueue(async () => ({ id: 'x' }), 'user-a');
    expect(before.foreignItems).toBe(1);
    expect(await getPending()).toHaveLength(1);

    // …adopted (explicit user action), then flushes under the adopter.
    const adopted = await adoptForeignItems('user-a');
    expect(adopted).toBe(1);
    const after = await flushQueue(async () => ({ id: 'x' }), 'user-a');
    expect(after.flushed).toBe(1);
    expect(after.foreignItems).toBe(0);
    expect(await getPending()).toHaveLength(0);
  });

  it('adopting with no foreign items is a no-op', async () => {
    const { adoptForeignItems } = await import('../../src/pwa/lib/offline');
    await queueItem({ type: 'family', payload: { data: { name: 'Own' }, proxyData: null } }, 'k-own', 'user-a');
    expect(await adoptForeignItems('user-a')).toBe(0);
  });
});

describe('adoptForeignItems — concurrent-update safety', () => {
  beforeEach(async () => {
    await freshDb();
  });

  it('preserves a bag flag set concurrently with adoption (no stale-snapshot overwrite)', async () => {
    const { adoptForeignItems, setItemBag, getItem } = await import('../../src/pwa/lib/offline');
    const id = await queueItem({ type: 'family', payload: { data: { name: 'Race Fam' }, proxyData: null } }, 'k-race', 'user-b');

    // Interleave: whichever transaction commits first, the other must see
    // its write — the cursor update reads the latest stored value, so the
    // bag flag survives in both orders.
    await Promise.all([
      adoptForeignItems('user-a'),
      setItemBag(id, true),
    ]);

    const item = await getItem(id);
    expect(item?.queuedByUserId).toBe('user-a');
    expect(item?.bag).toBe(true);
  });
});

describe('offline family directory (returning-household lookup)', () => {
  beforeEach(async () => {
    await freshDb();
  });

  const dirFam = (over: Record<string, unknown>) => ({
    id: 'fx', name: 'Fam', name_normalized: 'fam', phone: null, proxy_phones: [],
    num_people: null, last_visit_date: null, ...over,
  });

  it('caches the roster and finds a returning household by name or phone', async () => {
    const { cacheDirectory, searchDirectory } = await import('../../src/pwa/lib/offline');
    await cacheDirectory([
      dirFam({ id: 'f1', name: 'José García Familia', name_normalized: 'jose garcia familia', phone: '4805551111', num_people: 4, last_visit_date: '2026-08-01' }),
      dirFam({ id: 'f2', name: 'Chen Family', name_normalized: 'chen family', num_people: 2, last_visit_date: '2026-08-10' }),
    ]);

    // Accent-insensitive name match against the server-normalized name
    const byName = await searchDirectory('García', null);
    expect(byName.map(f => f.id)).toEqual(['f1']);
    // Phone match must normalize the QUERY like the server does — a +1
    // country code missed the stored 10-digit form before.
    const byPhone = await searchDirectory('', '+1 (480) 555-1111');
    expect(byPhone.map(f => f.id)).toEqual(['f1']);
    // Recency breaks equal-rank ties
    const both = await searchDirectory('familia', null);
    expect(both.length).toBeGreaterThanOrEqual(1);
    expect(both[0].id).toBe('f1');
  });

  it('matches with the SAME fuzziness as online search (Sxith → Smith offline)', async () => {
    const { cacheDirectory, searchDirectory } = await import('../../src/pwa/lib/offline');
    await cacheDirectory([
      dirFam({ id: 'sm', name: 'Smith Family', name_normalized: 'smith family' }),
    ]);
    // A weaker offline matcher silently routed this to register-as-new —
    // the duplicate-family path.
    const results = await searchDirectory('Sxith', null);
    expect(results.map(f => f.id)).toEqual(['sm']);
  });

  it('finds linked families by a designated pickup phone (proxy)', async () => {
    const { cacheDirectory, searchDirectory } = await import('../../src/pwa/lib/offline');
    await cacheDirectory([
      dirFam({ id: 'own', name: 'Vargas Family', name_normalized: 'vargas family', phone: '6025558888', proxy_phones: ['4805559999'] }),
      dirFam({ id: 'other', name: 'Unrelated Family', name_normalized: 'unrelated family', phone: '6025550000' }),
    ]);
    const results = await searchDirectory('', '480 555 9999');
    expect(results.map(f => f.id)).toEqual(['own']);
  });

  it('a re-cache fully replaces the previous roster', async () => {
    const { cacheDirectory, searchDirectory } = await import('../../src/pwa/lib/offline');
    await cacheDirectory([dirFam({ id: 'old', name: 'Old Family', name_normalized: 'old family' })]);
    await cacheDirectory([dirFam({ id: 'new', name: 'New Family', name_normalized: 'new family' })]);
    expect(await searchDirectory('family', null)).toHaveLength(1);
    expect((await searchDirectory('family', null))[0].id).toBe('new');
  });
});

describe('shared fuzzy accent fallback (no String.normalize — iOS 9)', () => {
  it('folds the Latin diacritics this population actually uses', async () => {
    const { foldAccentsFallback, normalizeName } = await import('../../src/shared/fuzzy');
    // The fallback must agree with the NFD path for these inputs.
    for (const s of ['García', 'José', 'Muñoz', 'Peña', 'AGÜERO', 'François']) {
      expect(foldAccentsFallback(s)).toBe(normalizeName(s));
    }
  });
});

describe('directoryPickup — offline proxy semantics', () => {
  beforeEach(async () => {
    await freshDb();
  });

  const dirFam2 = (over: Record<string, unknown>) => ({
    id: 'fx', name: 'Fam', name_normalized: 'fam', phone: null, proxy_phones: [],
    num_people: null, last_visit_date: null, ...over,
  });

  it('partitions the roster into own family and the families that designated this phone', async () => {
    const { cacheDirectory, directoryPickup } = await import('../../src/pwa/lib/offline');
    // One pickup person (4805550001): their OWN family plus TWO families
    // that designated them — all must be presented together, like online.
    await cacheDirectory([
      dirFam2({ id: 'own', name: 'Mendez Family', name_normalized: 'mendez family', phone: '4805550001' }),
      dirFam2({ id: 'p1', name: 'Vargas Family', name_normalized: 'vargas family', phone: '6025550002', proxy_phones: ['4805550001'], last_visit_date: '2026-08-01' }),
      dirFam2({ id: 'p2', name: 'Cruz Family', name_normalized: 'cruz family', phone: '6025550003', proxy_phones: ['4805550001'], last_visit_date: '2026-08-10' }),
      dirFam2({ id: 'x', name: 'Unrelated Family', name_normalized: 'unrelated family', phone: '6025550004' }),
    ]);

    const pickup = await directoryPickup('+1 480 555 0001');
    expect(pickup.own?.id).toBe('own');
    expect(pickup.proxy.map(f => f.id)).toEqual(['p2', 'p1']); // both, recency-sorted
  });

  it('proxy-only phone (no own family) still resolves the linked families', async () => {
    const { cacheDirectory, directoryPickup } = await import('../../src/pwa/lib/offline');
    await cacheDirectory([
      dirFam2({ id: 'p1', name: 'Vargas Family', name_normalized: 'vargas family', phone: '6025550002', proxy_phones: ['4805550009'] }),
    ]);
    const pickup = await directoryPickup('4805550009');
    expect(pickup.own).toBeNull();
    expect(pickup.proxy.map(f => f.id)).toEqual(['p1']);
  });
});

describe('directory epoch — stale refresh responses cannot commit', () => {
  beforeEach(async () => {
    await freshDb();
  });

  it('a refresh that started before an upsert is dropped instead of erasing it', async () => {
    const { cacheDirectory, upsertDirectoryFamilies, searchDirectory, nextDirectoryEpoch } = await import('../../src/pwa/lib/offline');
    const fam = { id: 'fresh', name: 'Fresh Family', name_normalized: 'fresh family', phone: null, proxy_phones: [], num_people: null, last_visit_date: null };

    // A full refresh claims its epoch, then (while its response is in
    // flight) a create-time upsert lands newer data…
    const staleEpoch = nextDirectoryEpoch();
    await upsertDirectoryFamilies([fam]);
    // …so the stale clear-and-replace must be a no-op.
    await cacheDirectory([], staleEpoch);
    expect((await searchDirectory('fresh', null)).map(f => f.id)).toEqual(['fresh']);

    // A refresh with a CURRENT epoch still commits.
    await cacheDirectory([], nextDirectoryEpoch());
    expect(await searchDirectory('fresh', null)).toHaveLength(0);
  });
});

describe('directory epoch — mid-open race (round-11)', () => {
  beforeEach(async () => {
    await freshDb();
  });

  // HONESTY NOTE: the dangerous interleave needs the stale refresh's
  // IndexedDB open to resolve AFTER a newer write committed. fake-indexeddb
  // resolves opens FIFO, so that inversion is not constructible through the
  // public API here (a gated-open monkeypatch was attempted and could not
  // beat the fake's dispatch internals). The post-open re-check in
  // cacheDirectory is therefore verified by reasoning — no yield exists
  // between the re-check and transaction creation, and same-store readwrite
  // transactions execute in creation order — plus this convergence test,
  // which pins that concurrent refresh+upsert always ends with the newer
  // data regardless of scheduling.
  it('concurrent stale refresh and upsert converge to the newer data', async () => {
    const { cacheDirectory, upsertDirectoryFamilies, searchDirectory, nextDirectoryEpoch } = await import('../../src/pwa/lib/offline');
    const fam = { id: 'newer', name: 'Newer Family', name_normalized: 'newer family', phone: null, proxy_phones: [], num_people: null, last_visit_date: null };

    const staleEpoch = nextDirectoryEpoch();
    const staleRefresh = cacheDirectory([], staleEpoch);
    const upsert = upsertDirectoryFamilies([fam]);
    await Promise.all([staleRefresh, upsert]);

    expect((await searchDirectory('newer', null)).map(f => f.id)).toEqual(['newer']);
  });
});
