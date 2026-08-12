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
  bag?: boolean;          // a bag was given for this submission's visit — applied after sync
  queuedByUserId?: string; // who entered it — a different login must not flush it under their identity
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
    req.onsuccess = () => {
      const db = req.result;
      // A second tab on old code holding the previous version would otherwise
      // block upgrades forever; close so the other tab's upgrade proceeds.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    // Surfaced instead of hanging: a blocked open means another tab pins an
    // old version — reject so callers report 'sync unavailable' rather than
    // silently never settling.
    req.onblocked = () => reject(new Error('offline storage blocked by another tab — close other tabs of this app'));
    req.onerror = () => reject(req.error);
  });
}

// Write transactions can terminate via the abort event WITHOUT a preceding
// error event (commit-time quota failure, browser storage eviction). Both
// paths must reject, or the caller's await hangs forever.
function rejectOnFailure(tx: IDBTransaction, reject: (err: unknown) => void) {
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error ?? new Error('offline storage transaction aborted'));
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
  idempotencyKey?: string,
  queuedByUserId?: string
): Promise<string> {
  const id = generateUUID();
  const key = idempotencyKey ?? id;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ ...item, id, idempotencyKey: key, createdAt: Date.now(), queuedByUserId });
    tx.oncomplete = () => { dispatchCountChange(); resolve(id); };
    rejectOnFailure(tx, reject);
  });
}

// Mark a queued submission as having received a bag; the flush applies it to
// the created visit after the item syncs.
export async function setItemBag(id: string, bag: boolean): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const item = getReq.result as PendingItem | undefined;
      if (!item) { reject(new Error('Queued item not found — it may have already synced')); return; }
      store.put({ ...item, bag });
    };
    tx.oncomplete = () => resolve();
    rejectOnFailure(tx, reject);
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

export async function getItem(id: string): Promise<PendingItem | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as PendingItem | undefined);
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

// Recovery for held entries whose owner can no longer sign in (deactivated
// or deleted account): explicitly re-attribute every foreign pending item to
// the given user so the next flush syncs them under that account. This is a
// deliberate human action behind a banner button — never automatic — because
// it trades attribution accuracy for not losing the data.
export async function adoptForeignItems(currentUserId: string): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    // Cursor read-modify-write inside ONE readwrite transaction: a separate
    // snapshot-then-put would write back stale copies, erasing concurrent
    // updates (a bag flag set between the read and the write).
    let adopted = 0;
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      const item = cursor.value as PendingItem;
      if (item.queuedByUserId && item.queuedByUserId !== currentUserId) {
        cursor.update({ ...item, queuedByUserId: currentUserId });
        adopted++;
      }
      cursor.continue();
    };
    tx.oncomplete = () => { if (adopted > 0) dispatchCountChange(); resolve(adopted); };
    rejectOnFailure(tx, reject);
  });
}

export async function removeItem(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { dispatchCountChange(); resolve(); };
    rejectOnFailure(tx, reject);
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
    rejectOnFailure(tx, reject);
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

// Delete only the given entries — acknowledging must not destroy entries
// that arrived after the banner rendered and were never shown.
export async function deleteDeadLetters(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DL_STORE, 'readwrite');
    const store = tx.objectStore(DL_STORE);
    for (const id of ids) store.delete(id);
    tx.oncomplete = () => resolve();
    rejectOnFailure(tx, reject);
  });
}

export async function clearDeadLetters(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DL_STORE, 'readwrite');
    tx.objectStore(DL_STORE).clear();
    tx.oncomplete = () => resolve();
    rejectOnFailure(tx, reject);
  });
}

export type ApiFn = (url: string, body: unknown, method?: 'POST' | 'PATCH') => Promise<unknown>;

// Thrown when the family/visit synced but the follow-up bag PATCH was
// rejected: the submission itself is SAVED, only the bag flag is not.
export class BagPatchError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'BagPatchError';
  }
}

// Duck-typed check for ApiError (avoids importing api.ts into this module)
function isApiError(err: unknown): err is { status: number; message: string } {
  return (
    err instanceof Error &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  );
}

// Single classification point for the post-sync bag PATCH: a non-401 4xx means
// the family/visit ARE saved and only the bag flag was rejected.
async function patchBagClassified(apiFn: ApiFn, visitId: string): Promise<void> {
  try {
    await apiFn(`/api/visits/${visitId}/bag`, { bag_received: true }, 'PATCH');
  } catch (err) {
    if (isApiError(err) && err.status >= 400 && err.status < 500 && err.status !== 401) {
      throw new BagPatchError(err.status, err.message);
    }
    throw err;
  }
}

// Exported so it can be unit-tested with an injected API function
export async function syncQueuedItem(item: PendingItem, apiFn: ApiFn): Promise<{ visitId?: string }> {
  const key = item.idempotencyKey ?? item.id;
  let visitId: string | undefined;
  if (item.type === 'visit') {
    const payload = item.payload as {
      family_id: string;
      visit_date: string;
      picked_up_by_phone?: string | null;
    };
    const visit = await apiFn('/api/visits', { ...payload, idempotency_key: key }) as { id?: string };
    visitId = visit?.id;
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
    const visit = await apiFn('/api/visits', {
      family_id: result.id,
      visit_date: visitDate,
      picked_up_by_phone: proxyData?.proxy_phone ?? null,
      idempotency_key: `${key}-visit`,
    }) as { id?: string };
    visitId = visit?.id;
  }
  // Bag allocated while the submission was offline: apply it to the synced
  // visit. Network/5xx failures throw and retry the whole item (idempotent);
  // a 4xx here means the DATA saved and only the bag flag was rejected, which
  // must not be recorded as a whole-submission failure.
  if (item.bag && visitId) {
    await patchBagClassified(apiFn, visitId);
  }
  return { visitId };
}

export interface FlushResult {
  flushed: number;        // synced and removed from queue
  errors: number;         // transient failures — still in queue, will retry
  deadLettered: number;   // permanent 4xx failures — removed from queue
  needsReLogin: boolean;  // a 401 was received — caller should prompt re-login
  foreignItems: number;   // queued by a DIFFERENT user — held until they sign in
  skipped?: true;         // another flush was in flight — NOT a clean result;
                          // callers must not clear warning state based on it
}

// In-flight guard: prevents mount and 'online' event from overlapping.
// A trigger that arrives mid-flush sets rerunRequested so the active flush
// runs a trailing pass instead of the trigger being dropped.
let flushing = false;
let rerunRequested = false;

export async function flushQueue(apiFn: ApiFn, currentUserId?: string): Promise<FlushResult> {
  if (flushing) {
    rerunRequested = true;
    return { flushed: 0, errors: 0, deadLettered: 0, needsReLogin: false, foreignItems: 0, skipped: true };
  }
  flushing = true;
  const result: FlushResult = { flushed: 0, errors: 0, deadLettered: 0, needsReLogin: false, foreignItems: 0 };
  try {
   do {
    rerunRequested = false;
    result.foreignItems = 0; // recounted each pass; foreign items persist
    const items = await getPending();
    for (const snapshot of items) {
      // Re-read just before syncing: setItemBag (or any update) landing after
      // the getPending snapshot must not be lost to a stale copy. A failed
      // re-read is NOT a license to use stale data — skip and retry later.
      let item: PendingItem;
      try {
        const fresh = await getItem(snapshot.id);
        if (!fresh) continue; // removed by a concurrent actor — nothing to sync
        item = fresh;
      } catch {
        result.errors++;
        continue;
      }
      // Shared-device protection: user A's entries must not be written under
      // user B's identity. Items with no attribution (legacy) flush normally.
      if (item.queuedByUserId && currentUserId && item.queuedByUserId !== currentUserId) {
        result.foreignItems++;
        continue;
      }
      try {
        const { visitId } = await syncQueuedItem(item, apiFn);
        // A bag set WHILE this item was syncing would vanish with removeItem —
        // re-read once more and catch it up before removal. If this re-read
        // fails we must NOT remove the item (a late bag flag could exist);
        // the item retries next flush — replay is idempotent server-side.
        if (visitId) {
          const fresh = await getItem(item.id);
          if (fresh?.bag && !item.bag) {
            await patchBagClassified(apiFn, visitId);
          }
        }
        try {
          await removeItem(item.id);
        } catch {
          // Synced but stuck in the queue: count as an error so the caller's
          // retry timer fires and the (idempotent) replay re-attempts removal.
          result.errors++;
        }
        result.flushed++;
      } catch (err) {
        if (err instanceof BagPatchError) {
          // Family and visit ARE saved — dead-letter an annotated bag-only
          // record so recovery is "fix the bag flag", not "re-enter the family"
          // (re-entry would duplicate what already saved).
          const bagItem = { ...item, payload: item.payload };
          try {
            await addDeadLetter(
              bagItem, err.status,
              `Bag flag only — the family and visit SAVED. Do not re-enter; mark the bag from View Records. (${err.message})`
            );
          } catch {
            result.errors++;
            continue;
          }
          // errors++ on a stuck removal so the retry timer fires (put() by
          // item id keeps the re-dead-letter an overwrite, not a duplicate).
          try { await removeItem(item.id); } catch { result.errors++; }
          result.deadLettered++;
        } else if (isApiError(err)) {
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
            // errors++ ensures the retry timer actually fires.
            try { await removeItem(item.id); } catch { result.errors++; }
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
   } while (rerunRequested);
  } finally {
    flushing = false;
    rerunRequested = false;
  }
  return result;
}
