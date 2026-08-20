// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveDraftNow, saveDraftDebounced, loadDraft, deleteDraft, hasSavedDraft, _setDebounceDelay,
} from '../../src/pwa/lib/draft';
import type { EntryDraft } from '../../src/pwa/lib/draft';
import { putInStore, getFromStore, DRAFT_STORE } from '../../src/pwa/lib/offline';

function makeDraft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    user_id: 'user-1',
    updatedAt: Date.now(),
    view: { type: 'lookup' },
    wizard: null,
    pendingSubmission: null,
    pendingFamilies: [],
    pendingVisitIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  _setDebounceDelay(10);
});

describe('saveDraftNow / loadDraft', () => {
  it('round-trips a draft for the given user', async () => {
    const draft = makeDraft({ user_id: 'user-round-trip', wizard: { step: 5, data: { name: 'Test' } } });
    await saveDraftNow(draft);
    const loaded = await loadDraft('user-round-trip');
    expect(loaded?.wizard).toEqual({ step: 5, data: { name: 'Test' } });
  });

  it('marks hasSavedDraft(userId) true after a successful save, for that user only', async () => {
    const draft = makeDraft({ user_id: 'user-flag' });
    await saveDraftNow(draft);
    expect(hasSavedDraft('user-flag')).toBe(true);
    expect(hasSavedDraft('some-other-user')).toBe(false);
    expect(hasSavedDraft(undefined)).toBe(false);
  });

  it('marks hasSavedDraft(userId) true when loadDraft finds a fresh draft (crash-after-load case)', async () => {
    const draft = makeDraft({ user_id: 'user-flag-2' });
    await saveDraftNow(draft);
    await deleteDraft(draft.user_id); // clears the flag
    expect(hasSavedDraft(draft.user_id)).toBe(false);
    await saveDraftNow(draft); // re-save so loadDraft has something fresh
    await deleteDraft(draft.user_id);
    expect(hasSavedDraft(draft.user_id)).toBe(false);
    await saveDraftNow(draft);
    const loaded = await loadDraft(draft.user_id);
    expect(loaded).not.toBeNull();
    expect(hasSavedDraft(draft.user_id)).toBe(true);
  });

  it('does not leak a saved-draft claim across users sharing the same tab (cross-user finding, PR #14)', async () => {
    // Volunteer A saves a draft, then abandons it (no delete — matches a
    // real logout, which never calls deleteDraft).
    await saveDraftNow(makeDraft({ user_id: 'volunteer-a' }));
    expect(hasSavedDraft('volunteer-a')).toBe(true);
    // Volunteer B signs in on the same tab/device — has no draft of their
    // own. Must NOT see A's leftover flag.
    expect(hasSavedDraft('volunteer-b')).toBe(false);
  });

  it('is a no-op for an undefined user_id (never throws)', async () => {
    await expect(saveDraftNow(makeDraft({ user_id: undefined as unknown as string }))).resolves.toBeUndefined();
    await expect(loadDraft(undefined)).resolves.toBeNull();
  });
});

describe('loadDraft — expiry', () => {
  it('a freshly saved draft is not treated as expired', async () => {
    const userId = 'user-fresh';
    await saveDraftNow(makeDraft({ user_id: userId }));
    const fresh = await loadDraft(userId);
    expect(fresh).not.toBeNull();
  });

  it('returns null and deletes a draft older than 4 hours (review finding: the previous version of this test never actually exercised the deletion path — saveDraftNow always re-stamps updatedAt to "now", silently defeating an old-timestamp fixture)', async () => {
    const userId = 'user-expired';
    // Seed the store directly via offline.ts, bypassing saveDraftNow's
    // "now" re-stamp, so the fixture's old timestamp actually survives.
    const stale: EntryDraft = { ...makeDraft({ user_id: userId }), updatedAt: Date.now() - (5 * 60 * 60 * 1000) };
    await putInStore(DRAFT_STORE, stale);
    // Sanity check the fixture itself is really stale before trusting the
    // result below — otherwise a broken seed would look identical to a
    // passing expiry check.
    const seeded = await getFromStore<EntryDraft>(DRAFT_STORE, userId);
    expect(seeded?.updatedAt).toBe(stale.updatedAt);

    const loaded = await loadDraft(userId);
    expect(loaded).toBeNull();
    const afterLoad = await getFromStore<EntryDraft>(DRAFT_STORE, userId);
    expect(afterLoad).toBeUndefined(); // loadDraft deleted the expired row
  });
});

describe('saveDraftDebounced', () => {
  it('coalesces rapid calls into one write, landing after the delay', async () => {
    const userId = 'user-debounced';
    saveDraftDebounced(makeDraft({ user_id: userId, wizard: { step: 1, data: {} } }));
    saveDraftDebounced(makeDraft({ user_id: userId, wizard: { step: 2, data: {} } }));
    saveDraftDebounced(makeDraft({ user_id: userId, wizard: { step: 3, data: {} } }));
    // Not yet written (debounce pending)
    await new Promise(r => setTimeout(r, 5));
    // Wait past the debounce delay (10ms in this suite)
    await new Promise(r => setTimeout(r, 30));
    const loaded = await loadDraft(userId);
    expect(loaded?.wizard).toEqual({ step: 3, data: {} });
  });

  it('saveDraftNow cancels a pending debounced write so it cannot resurrect after delete', async () => {
    const userId = 'user-resurrect';
    await saveDraftNow(makeDraft({ user_id: userId, wizard: { step: 1, data: {} } }));
    // Queue a debounced write (simulating a trailing keystroke)...
    saveDraftDebounced(makeDraft({ user_id: userId, wizard: { step: 1, data: { name: 'typed after submit' } } }));
    // ...then immediately submit: saveDraftNow the terminal state and delete.
    await deleteDraft(userId);
    // Wait past the debounce delay — if the timer weren't cancelled, this
    // write would resurrect a draft for an already-submitted entry.
    await new Promise(r => setTimeout(r, 30));
    const loaded = await loadDraft(userId);
    expect(loaded).toBeNull();
  });

  it('deleteDraft cancels a pending debounced write', async () => {
    const userId = 'user-delete-cancels';
    saveDraftDebounced(makeDraft({ user_id: userId, wizard: { step: 1, data: {} } }));
    await deleteDraft(userId);
    await new Promise(r => setTimeout(r, 30));
    const loaded = await loadDraft(userId);
    expect(loaded).toBeNull();
  });
});

describe('deleteDraft', () => {
  it('removes the draft and clears hasSavedDraft(userId)', async () => {
    const userId = 'user-clear';
    await saveDraftNow(makeDraft({ user_id: userId }));
    expect(hasSavedDraft(userId)).toBe(true);
    await deleteDraft(userId);
    expect(hasSavedDraft(userId)).toBe(false);
    expect(await loadDraft(userId)).toBeNull();
  });

  it('is a no-op for an undefined user_id', async () => {
    await expect(deleteDraft(undefined)).resolves.toBeUndefined();
  });
});
