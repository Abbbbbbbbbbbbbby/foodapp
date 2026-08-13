import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../src/pwa/lib/offline', () => ({
  getPendingCount: vi.fn(async () => 0),
  flushQueue: vi.fn(async () => ({ flushed: 0, errors: 0, deadLettered: 0, needsReLogin: false, foreignItems: 0 })),
  getDeadLetters: vi.fn(async () => []),
  deleteDeadLetters: vi.fn(async () => undefined),
  adoptForeignItems: vi.fn(async () => 0),
  cacheDirectory: vi.fn(async () => undefined),
}));
const authState = vi.hoisted(() => ({
  user: { id: 'u1', name: 'Vol One', phone: '4805550001', role: 'volunteer' } as
    { id: string; name: string; phone: string; role: string } | null,
}));
vi.mock('../../src/pwa/store/auth', () => ({
  getUser: () => authState.user,
  getAuth: () => (authState.user ? { token: 'tok', user: authState.user } : null),
  getToken: () => (authState.user ? 'tok' : null),
  clearAuth: vi.fn(),
  AUTH_STORAGE_KEY: 'foodapp_auth',
}));
vi.mock('../../src/pwa/lib/api', () => ({
  api: { post: vi.fn(), patch: vi.fn(), get: vi.fn() },
  apiWithToken: vi.fn(() => ({ post: vi.fn(), patch: vi.fn(), get: vi.fn(async () => ({ families: [] })) })),
  ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));

import Layout from '../../src/pwa/components/Layout';
import { getDeadLetters, deleteDeadLetters, flushQueue, adoptForeignItems } from '../../src/pwa/lib/offline';
import { api, apiWithToken } from '../../src/pwa/lib/api';
import type { DeadLetterEntry } from '../../src/pwa/lib/offline';

const dl = (id: string, label: string): DeadLetterEntry => ({
  id, timestamp: 1754900000000, type: 'family', label,
  errorStatus: 400, errorMessage: 'invalid hispanic value',
  payload: { data: { name: label, num_people: 4 } }, idempotencyKey: `key-${id}`,
});

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<div>HOME CONTENT</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('Layout dead-letter banner', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders no banner when the store is empty', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    renderLayout();
    await screen.findByText('HOME CONTENT');
    expect(screen.queryByText(/could not be saved/)).not.toBeInTheDocument();
  });

  it('shows entries with recoverable payload detail and error', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([dl('d1', 'Reyes Family')]);
    const user = userEvent.setup();
    renderLayout();

    expect(await screen.findByText(/1 entry could not be saved/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getAllByText(/Reyes Family/).length).toBeGreaterThan(0);
    expect(screen.getByText(/invalid hispanic value/)).toBeInTheDocument();
    // Full payload rendered — the recoverable copy
    expect(screen.getByText(/"num_people": 4/)).toBeInTheDocument();
  });

  it('acknowledge deletes ONLY the displayed entries and keeps late arrivals', async () => {
    vi.mocked(getDeadLetters)
      .mockResolvedValueOnce([dl('d1', 'Shown Family')])       // mount load
      .mockResolvedValueOnce([dl('d1', 'Shown Family')])       // post-flush unconditional refresh
      .mockResolvedValue([dl('d2', 'Late Family')]);            // re-read after acknowledge
    const user = userEvent.setup();
    renderLayout();

    await screen.findByText(/1 entry could not be saved/);
    await user.click(screen.getByRole('button', { name: 'Details' }));
    await user.click(screen.getByRole('button', { name: /Acknowledge and dismiss/ }));

    await waitFor(() => expect(deleteDeadLetters).toHaveBeenCalledWith(['d1']));
    // The late entry re-renders the banner rather than being wiped unseen
    expect(await screen.findByText(/1 entry could not be saved/)).toBeInTheDocument();
  });
});

describe('Layout session and sync banners (issue #6)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a 401 during flush shows the sign-in banner instead of yanking to /login', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    vi.mocked(flushQueue).mockResolvedValue({ flushed: 0, errors: 0, deadLettered: 0, needsReLogin: true, foreignItems: 0 });
    renderLayout();

    expect(await screen.findByText(/Session expired/)).toBeInTheDocument();
    // Still on the page — work not lost
    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in/ })).toBeInTheDocument();
  });

  it('foreign queued items surface a that-person-must-sign-in notice', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    vi.mocked(flushQueue).mockResolvedValue({ flushed: 0, errors: 0, deadLettered: 0, needsReLogin: false, foreignItems: 2 });
    renderLayout();

    expect(await screen.findByText(/2 entries from a different account/)).toBeInTheDocument();
  });

  it('held entries can be deliberately adopted (two clicks) when the owner cannot sign in', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    vi.mocked(flushQueue).mockResolvedValue({ flushed: 0, errors: 0, deadLettered: 0, needsReLogin: false, foreignItems: 2 });
    const user = userEvent.setup();
    renderLayout();

    await screen.findByText(/2 entries from a different account/);
    // First click only ARMS — no adoption yet.
    await user.click(screen.getByRole('button', { name: /Sync under my account/ }));
    expect(adoptForeignItems).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Confirm: record these entries as mine/ }));
    await waitFor(() => expect(adoptForeignItems).toHaveBeenCalledWith('u1'));
    expect(screen.queryByText(/2 entries from a different account/)).not.toBeInTheDocument();
  });

  it('pins the flush identity: the apiFn handed to flushQueue routes through the pinned client, with the same-snapshot user id', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    vi.mocked(flushQueue).mockResolvedValue({ flushed: 0, errors: 0, deadLettered: 0, needsReLogin: false, foreignItems: 0 });
    renderLayout();

    await waitFor(() => expect(flushQueue).toHaveBeenCalled());
    expect(apiWithToken).toHaveBeenCalledWith('tok');
    // Token and user id must come from ONE auth snapshot.
    expect(vi.mocked(flushQueue).mock.calls[0][1]).toBe('u1');

    // Drive the ACTUAL apiFn Layout handed to flushQueue: it must hit the
    // pinned client — a regression to the live `api` would pass a
    // call-count-only assertion but fails this one.
    const apiFn = vi.mocked(flushQueue).mock.calls[0][0] as
      (url: string, body: unknown, method?: 'POST' | 'PATCH') => Promise<unknown>;
    await apiFn('/api/families', { name: 'X' });
    await apiFn('/api/visits/v1/bag', { bag_received: true }, 'PATCH');
    // apiWithToken is also used by the directory refresh — find the pinned
    // instance the flush actually drove rather than assuming call order.
    const pinnedClient = vi.mocked(apiWithToken).mock.results
      .map(r => r.value).find(c => c.post.mock.calls.length > 0);
    expect(pinnedClient).toBeTruthy();
    expect(pinnedClient.post).toHaveBeenCalledWith('/api/families', { name: 'X' });
    expect(pinnedClient.patch).toHaveBeenCalledWith('/api/visits/v1/bag', { bag_received: true });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('a flush exception shows the sync-unavailable banner', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    vi.mocked(flushQueue).mockRejectedValue(new Error('blocked by another tab'));
    renderLayout();

    expect(await screen.findByText(/Offline sync is unavailable/)).toBeInTheDocument();
  });

  it('a failed dead-letter read right after dead-lettering surfaces as sync-broken', async () => {
    // Items were JUST permanently dead-lettered; if the banner refresh read
    // fails silently, the volunteer's only signal reads as "it synced".
    vi.mocked(getDeadLetters)
      .mockResolvedValueOnce([])                        // mount load
      .mockRejectedValue(new Error('IDB read failed')); // post-flush refresh
    vi.mocked(flushQueue).mockResolvedValue({ flushed: 0, errors: 0, deadLettered: 1, needsReLogin: false, foreignItems: 0 });
    renderLayout();

    expect(await screen.findByText(/Offline sync is unavailable/)).toBeInTheDocument();
  });

  it('a skipped (in-flight) flush result does NOT clear existing warning banners', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    vi.mocked(flushQueue)
      .mockRejectedValueOnce(new Error('IDB broken'))  // mount: banner appears
      .mockResolvedValue({ flushed: 0, errors: 0, deadLettered: 0, needsReLogin: false, foreignItems: 0, skipped: true });
    renderLayout();

    expect(await screen.findByText(/Offline sync is unavailable/)).toBeInTheDocument();

    // A later trigger whose flush was skipped says nothing about queue
    // health — the banner must survive it.
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByText(/Offline sync is unavailable/)).toBeInTheDocument();
  });
});

describe('Layout cross-tab account-change overlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 'u1', name: 'Vol One', phone: '4805550001', role: 'volunteer' };
  });

  function fireAuthStorageEvent() {
    window.dispatchEvent(new StorageEvent('storage', { key: 'foodapp_auth' }));
  }

  it('another tab signing in as a different user blocks the tab but PRESERVES the page', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    renderLayout();
    await screen.findByText('HOME CONTENT');

    authState.user = { id: 'u2', name: 'Vol Two', phone: '4805550002', role: 'volunteer' };
    await act(async () => { fireAuthStorageEvent(); });

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/signed in as Vol Two/);
    expect(dialog).toHaveTextContent(/paused, not lost/);
    // Draft-bearing content is still mounted underneath, NOT reloaded away.
    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument();
    // Proceeding under the new identity requires the explicit discard button.
    expect(screen.getByRole('button', { name: /Discard this entry and continue as Vol Two/ })).toBeInTheDocument();
  });

  it('clears automatically when the original account is restored', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    renderLayout();
    await screen.findByText('HOME CONTENT');

    authState.user = { id: 'u2', name: 'Vol Two', phone: '4805550002', role: 'volunteer' };
    await act(async () => { fireAuthStorageEvent(); });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    // Original user signs back in on the other tab — identity reconciled.
    authState.user = { id: 'u1', name: 'Vol One', phone: '4805550001', role: 'volunteer' };
    await act(async () => { fireAuthStorageEvent(); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('HOME CONTENT')).toBeInTheDocument();
  });

  it('a cross-tab sign-out shows the signed-out variant', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    renderLayout();
    await screen.findByText('HOME CONTENT');

    authState.user = null;
    await act(async () => { fireAuthStorageEvent(); });

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/signed out in another tab/);
    expect(screen.getByRole('button', { name: /Discard this entry and go to sign-in/ })).toBeInTheDocument();
  });
});

describe('Layout overlay real modality (round-7 P1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 'u1', name: 'Vol One', phone: '4805550001', role: 'volunteer' };
  });

  it('steals focus from a draft submit button and recaptures any focus escape', async () => {
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<button>Save draft</button>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
    const draftButton = await screen.findByRole('button', { name: 'Save draft' });
    draftButton.focus();
    expect(document.activeElement).toBe(draftButton);

    // Cross-tab switch: the reproduced attack was Enter on the still-focused
    // draft button firing the handler BEHIND the overlay.
    authState.user = { id: 'u2', name: 'Vol Two', phone: '4805550002', role: 'volunteer' };
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'foodapp_auth' }));
    });

    // Focus was MOVED into the dialog — Enter now lands on the dialog control.
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.contains(document.activeElement)).toBe(true);

    // An escape attempt (script, quirky browser, tab restore) is recaptured.
    await act(async () => { draftButton.focus(); });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(draftButton);
  });
});

describe('Layout offline-capability notice (no service worker)', () => {
  it('devices without service workers see the keep-tab-open notice', async () => {
    // jsdom has no navigator.serviceWorker — exactly the iOS 9 situation.
    vi.mocked(getDeadLetters).mockResolvedValue([]);
    renderLayout();
    expect(await screen.findByText(/keep this tab open during outages/)).toBeInTheDocument();
  });
});
