const DB_NAME = 'foodapp_offline';
const DB_VERSION = 2;
const STORE = 'pending';
const DL_STORE = 'dead-letter';

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

export interface DeadLetterEntry {
  id: string;             // same id as the pending queue entry — put() makes re-dead-lettering idempotent
  timestamp: number;
  type: PendingItem['type'];
  label: string;          // best-effort name/identifier for display
  errorStatus: number;
  errorMessage: string;
  payload: unknown;       // full original submission — recoverable/re-enterable
  idempotencyKey: string; // replaying via this key cannot create a duplicate
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const oldVersion = (e as IDBVersionChangeEvent).oldVersion;
      if (oldVersion < 1) db.createObjectStore(STORE, { keyPath: 'id' });
      if (oldVersion < 2) db.createObjectStore(DL_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dispatchCountChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('offlinecountchange'));
  }
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
    const items: PendingItem[] = [];
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        items.push(cursor.value as PendingItem);
        cursor.continue();
      } else {
        resolve(items);
      }
    };
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

async function addDeadLetter(item: PendingItem, errorStatus: number, errorMessage: string): Promise<void> {
  let label = item.type === 'family'
    ? ((item.payload as { data?: { name?: string } })?.data?.name ?? 'Unknown family')
    : `Visit for family ${(item.payload as { family_id?: string })?.family_id ?? '?'}`;
  const entry: DeadLetterEntry = {
    id: item.id,
    timestamp: Date.now(),
    type: item.type,
    label,
    errorStatus,
    errorMessage,
    payload: item.payload,
    idempotencyKey: item.idempotencyKey ?? item.id,
  };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DL_STORE, 'readwrite');
    // put(), keyed by the pending item's id: if removeItem fails afterward and
    // the item is re-dead-lettered on a later flush, it overwrites rather than
    // duplicating the entry.
    tx.objectStore(DL_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDeadLetters(): Promise<DeadLetterEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DL_STORE, 'readonly');
    const items: DeadLetterEntry[] = [];
    const req = tx.objectStore(DL_STORE).openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        items.push(cursor.value as DeadLetterEntry);
        cursor.continue();
      } else {
        resolve(items);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearDeadLetters(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DL_STORE, 'readwrite');
    tx.objectStore(DL_STORE).clear();
    tx.oncomplete = () => resolve();
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
  const key = item.idempotencyKey ?? item.id;
  if (item.type === 'visit') {
    const payload = item.payload as {
      family_id: string;
      visit_date: string;
      picked_up_by_phone?: string | null;
    };
    await apiFn('/api/visits', { ...payload, idempotency_key: key });
  } else {
    // type === 'family': POST family then POST visit with derived idempotency keys
    const { data, proxyData } = item.payload as {
      data: Record<string, unknown>;
      proxyData: { proxy_phone?: string | null } | null;
    };
    const result = await apiFn('/api/families', {
      ...data,
      proxy: proxyData ?? undefined,
      idempotency_key: key,
    }) as { id: string };
    const d = new Date();
    const todayLocal = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const visitDate = (data.first_visit_date as string | undefined) ?? todayLocal;
    await apiFn('/api/visits', {
      family_id: result.id,
      visit_date: visitDate,
      picked_up_by_phone: proxyData?.proxy_phone ?? null,
      idempotency_key: `${key}-visit`,
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
            // Permanent client error. Persist the durable dead-letter record
            // FIRST; only remove from pending if that write succeeded. If the
            // dead-letter write fails, the item stays queued (bounded retry
            // beats silent loss).
            try {
              await addDeadLetter(item, err.status, err.message);
            } catch {
              result.errors++;
              continue;
            }
            // If this remove fails the item retries next flush and re-dead-
            // letters; put() by item id makes that overwrite, not duplicate.
            try { await removeItem(item.id); } catch { /* retried next flush */ }
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
