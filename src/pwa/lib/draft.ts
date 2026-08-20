import { putInStore, getFromStore, deleteFromStore, DRAFT_STORE } from './offline';
import type { EnterView } from './types';
import type { SummaryFamily } from '../components/enter/SummaryScreen';

const DRAFT_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const DEBOUNCE_DELAY_MS = 500;

export interface PendingVisitRef {
  visitId: string | null;
  queueId: string | null;
  visitKey: string;
}

export interface EntryDraft {
  user_id: string;
  updatedAt: number;
  view: EnterView;
  wizard: { step: number; data: unknown } | null;
  // The idempotency key(s) for a submission that may be in flight at the
  // moment this draft was written. Reusing the SAME key on resume (instead
  // of minting a fresh one) is what makes a resumed submission a safe
  // retry through the server's existing idempotency handling, rather than
  // a genuine duplicate family/visit — review finding, PR #14.
  pendingSubmission: { familyIdemKey?: string; visitIdemKey?: string } | null;
  pendingFamilies: SummaryFamily[];
  pendingVisitIds: PendingVisitRef[];
}

// Sync flag for the ErrorBoundary's fallback copy: does a resumable draft
// exist FOR THE CURRENTLY SIGNED-IN USER? Set both when a save actually
// lands, and when loadDraft() finds a fresh one — a crash between "draft
// loaded" and "user clicked Resume" must still tell the truth about
// recoverability. Scoped per user_id (not a bare boolean) — logout in this
// app is a client-side navigate() with no page reload, so module state
// otherwise survives across users in the same tab: volunteer A abandons a
// draft, volunteer B signs in and crashes before B has any draft of their
// own, and a bare flag would falsely tell B their (nonexistent) entry was
// saved. Review finding, PR #14.
let savedDraftForUserId: string | null = null;
export function hasSavedDraft(userId: string | undefined): boolean {
  return !!userId && savedDraftForUserId === userId;
}

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let debounceDelay = DEBOUNCE_DELAY_MS;

// Test-only override — real fake timers deadlock against fake-indexeddb's
// off-timer transaction completion, so tests shrink the delay instead of
// mocking the clock.
export function _setDebounceDelay(ms: number): void {
  debounceDelay = ms;
}

function cancelDebounce(userId: string) {
  const t = debounceTimers.get(userId);
  if (t) {
    clearTimeout(t);
    debounceTimers.delete(userId);
  }
}

export async function saveDraftNow(draft: EntryDraft): Promise<void> {
  if (!draft.user_id) return;
  cancelDebounce(draft.user_id);
  try {
    await putInStore(DRAFT_STORE, { ...draft, updatedAt: Date.now() });
    savedDraftForUserId = draft.user_id;
  } catch (err) {
    // Draft persistence is best-effort: a write failure must not break the
    // check-in flow itself, but it must be visible somewhere (matches the
    // rememberInDirectory pattern in EnterPage.tsx) — silent here means
    // both the draft safety net AND field debugging go dark together.
    console.warn('draft save failed:', err);
  }
}

export function saveDraftDebounced(draft: EntryDraft): void {
  if (!draft.user_id) return;
  cancelDebounce(draft.user_id);
  const timer = setTimeout(() => {
    debounceTimers.delete(draft.user_id);
    void saveDraftNow(draft);
  }, debounceDelay);
  debounceTimers.set(draft.user_id, timer);
}

export async function loadDraft(userId: string | undefined): Promise<EntryDraft | null> {
  if (!userId) return null;
  try {
    const draft = await getFromStore<EntryDraft>(DRAFT_STORE, userId);
    if (!draft) return null;
    if (Date.now() - draft.updatedAt > DRAFT_MAX_AGE_MS) {
      await deleteDraft(userId);
      return null;
    }
    savedDraftForUserId = userId;
    return draft;
  } catch (err) {
    console.warn('draft load failed:', err);
    return null;
  }
}

export async function deleteDraft(userId: string | undefined): Promise<void> {
  if (!userId) return;
  cancelDebounce(userId);
  if (savedDraftForUserId === userId) savedDraftForUserId = null;
  try {
    await deleteFromStore(DRAFT_STORE, userId);
  } catch (err) {
    // Best-effort: a stale draft surviving a failed delete is recoverable
    // (it just re-offers the resume prompt next time), never a crash —
    // but still worth a trace for field debugging.
    console.warn('draft delete failed:', err);
  }
}
