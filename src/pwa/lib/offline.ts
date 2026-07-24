const DB_NAME = 'foodapp_offline';
const STORE = 'pending';

// crypto.randomUUID() not available in Safari 9; use Math.random-based v4 UUID
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export interface PendingItem {
  id: string;             // IndexedDB key (unique per queue entry)
  idempotencyKey: string; // sent to server; stable across retries for the same submission
  type: 'family' | 'visit';
  payload: unknown;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dispatchCountChange() {
  window.dispatchEvent(new Event('offlinecountchange'));
}

// Accept an explicit idempotency key (generated before the first attempt) so
// the same key can be sent on both the foreground POST and any later retries.
// Falls back to the queue item's own UUID when no key is supplied.
export async function queueItem(
  item: Pick<PendingItem, 'type' | 'payload'>,
  idempotencyKey?: string
): Promise<void> {
  const id = generateUUID();
  const key = idempotencyKey ?? id;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ ...item, id, idempotencyKey: key, createdAt: Date.now() });
    tx.oncomplete = () => { dispatchCountChange(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPending(): Promise<PendingItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as PendingItem[]);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

export async function removeItem(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { dispatchCountChange(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

export type ApiFn = (url: string, body: unknown) => Promise<unknown>;

// Duck-typed check for ApiError (avoids importing api.ts into this module)
function isApiError(err: unknown): err is { status: number; message: string } {
  return (
    err instanceof Error &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  );
}

// Exported so it can be unit-tested with an injected API function
export async function syncQueuedItem(item: PendingItem, apiFn: ApiFn): Promise<void> {
  if (item.type === 'visit') {
    const payload = item.payload as {
      family_id: string;
      visit_date: string;
      picked_up_by_phone?: string | null;
    };
    await apiFn('/api/visits', { ...payload, idempotency_key: item.idempotencyKey });
  } else {
    // type === 'family': POST family then POST visit with derived idempotency keys
    const { data, proxyData } = item.payload as {
      data: Record<string, unknown>;
      proxyData: { proxy_phone?: string | null } | null;
    };
    const result = await apiFn('/api/families', {
      ...data,
      proxy: proxyData ?? undefined,
      idempotency_key: item.idempotencyKey,
    }) as { id: string };
    const visitDate = (data.first_visit_date as string | undefined) ?? new Date().toISOString().slice(0, 10);
    await apiFn('/api/visits', {
      family_id: result.id,
      visit_date: visitDate,
      picked_up_by_phone: proxyData?.proxy_phone ?? null,
      idempotency_key: `${item.idempotencyKey}-visit`,
    });
  }
}

export interface FlushResult {
  flushed: number;        // synced and removed from queue
  errors: number;         // transient failures — still in queue, will retry
  deadLettered: number;   // permanent 4xx failures — removed from queue
  needsReLogin: boolean;  // a 401 was received — caller should redirect to login
}

// In-flight guard: prevents mount and 'online' event from overlapping
let flushing = false;

export async function flushQueue(apiFn: ApiFn): Promise<FlushResult> {
  if (flushing) return { flushed: 0, errors: 0, deadLettered: 0, needsReLogin: false };
  flushing = true;
  const result: FlushResult = { flushed: 0, errors: 0, deadLettered: 0, needsReLogin: false };
  try {
    const items = await getPending();
    for (const item of items) {
      try {
        await syncQueuedItem(item, apiFn);
        await removeItem(item.id);
        result.flushed++;
      } catch (err) {
        if (isApiError(err)) {
          if (err.status === 401) {
            result.needsReLogin = true;
            // Don't dead-letter: the item may succeed after re-login
          } else if (err.status >= 400 && err.status < 500) {
            // Permanent client error — retrying will always fail; remove from queue
            await removeItem(item.id);
            result.deadLettered++;
          } else {
            // 5xx: transient server error — keep in queue
            result.errors++;
          }
        } else {
          // TypeError / network error — keep in queue
          result.errors++;
        }
      }
    }
  } finally {
    flushing = false;
  }
  return result;
}
