import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  queueItem, getPending, getDeadLetters, clearDeadLetters, flushQueue,
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
    const req = indexedDB.open('foodapp_offline', 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('dead-letter')) db.createObjectStore('dead-letter', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('directory')) db.createObjectStore('directory', { keyPath: 'id' });
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

  it('caches the roster and finds a returning household by partial name or phone', async () => {
    const { cacheDirectory, searchDirectory } = await import('../../src/pwa/lib/offline');
    await cacheDirectory([
      { id: 'f1', name: 'José García Familia', phone: '4805551111', num_people: 4, last_visit_date: '2026-08-01' },
      { id: 'f2', name: 'Chen Family', phone: null, num_people: 2, last_visit_date: '2026-08-10' },
    ]);

    // Accent-folded name substring
    const byName = await searchDirectory('garcia', null);
    expect(byName.map(f => f.id)).toEqual(['f1']);
    // Phone digits
    const byPhone = await searchDirectory('', '480-555-1111');
    expect(byPhone.map(f => f.id)).toEqual(['f1']);
    // Most recently seen ranks first
    const both = await searchDirectory('fam', null); // matches both names
    expect(both).toHaveLength(2);
    expect(both[0].id).toBe('f2');
  });

  it('a re-cache fully replaces the previous roster', async () => {
    const { cacheDirectory, searchDirectory } = await import('../../src/pwa/lib/offline');
    await cacheDirectory([{ id: 'old', name: 'Old Family', phone: null, num_people: 1, last_visit_date: null }]);
    await cacheDirectory([{ id: 'new', name: 'New Family', phone: null, num_people: 1, last_visit_date: null }]);
    expect(await searchDirectory('family', null)).toHaveLength(1);
    expect((await searchDirectory('family', null))[0].id).toBe('new');
  });
});
