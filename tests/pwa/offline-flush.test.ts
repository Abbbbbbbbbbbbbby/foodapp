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
    const req = indexedDB.open('foodapp_offline', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('dead-letter')) db.createObjectStore('dead-letter', { keyPath: 'id' });
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
