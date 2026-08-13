import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The component pins bag saves to one auth snapshot via apiWithToken — the
// tests drive the pinned client's fns (a stable hoisted object so every
// apiWithToken() call returns the same spies).
const pinned = vi.hoisted(() => ({ patch: vi.fn(), get: vi.fn(), post: vi.fn() }));
vi.mock('../../src/pwa/lib/api', () => ({
  api: { patch: vi.fn(), get: vi.fn(), post: vi.fn() },
  apiWithToken: vi.fn(() => pinned),
  ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));
vi.mock('../../src/pwa/store/auth', () => ({
  getAuth: () => ({ token: 'tok', user: { id: 'u1', name: 'Vol One', phone: '4805550001', role: 'volunteer' } }),
}));
vi.mock('../../src/pwa/lib/offline', () => ({
  setItemBag: vi.fn(),
}));

import SummaryScreen, { type SummaryFamily } from '../../src/pwa/components/enter/SummaryScreen';
import { apiWithToken } from '../../src/pwa/lib/api';
import { setItemBag } from '../../src/pwa/lib/offline';
const api = pinned; // every existing assertion now targets the pinned client

const fam = (over: Partial<SummaryFamily>): SummaryFamily => ({
  id: 'f1', name: 'Fam', num_people: 3, bag_received: null, visitId: 'v1', queueId: null, visitKey: 'vk-1', ...over,
});

describe('SummaryScreen bag picklist', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reveals the per-family picklist behind the bilingual bag question', async () => {
    const user = userEvent.setup();
    render(<SummaryScreen families={[fam({ id: 'a', name: 'Garcia' }), fam({ id: 'b', name: 'Lopez', visitId: 'v2' })]} onNext={() => {}} />);

    expect(screen.getByText(/Did they receive a reusable Creighton food bag\?/)).toBeInTheDocument();
    expect(screen.queryByText(/Which families received a bag\?/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByText(/Which families received a bag\?/)).toBeInTheDocument();
    expect(screen.getByText('Garcia')).toBeInTheDocument();
    expect(screen.getByText('Lopez')).toBeInTheDocument();
  });

  it('PATCHes only selected synced families and setItemBag for queued ones', async () => {
    vi.mocked(api.patch).mockResolvedValue({});
    vi.mocked(setItemBag).mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<SummaryScreen families={[
      fam({ id: 'a', name: 'Synced', visitId: 'v9' }),
      fam({ id: '', name: 'Queued', visitId: null, queueId: 'q1' }),
    ]} onNext={() => {}} />);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Save bags/ }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/api/visits/v9/bag', { bag_received: true });
      expect(setItemBag).toHaveBeenCalledWith('q1', true);
    });
    expect(screen.getByText(/Recorded/)).toBeInTheDocument();
  });

  it('partial failure keeps ONLY the failed family listed for retry', async () => {
    vi.mocked(api.patch).mockImplementation(async (url: string) => {
      if (url.includes('v-bad')) throw new Error('boom');
      return {};
    });
    const user = userEvent.setup();
    render(<SummaryScreen families={[
      fam({ id: 'ok', name: 'Fine Family', visitId: 'v-ok' }),
      fam({ id: 'bad', name: 'Broken Family', visitId: 'v-bad' }),
    ]} onNext={() => {}} />);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Save bags/ }));

    await waitFor(() => expect(screen.getByText(/Failed: Broken Family/)).toBeInTheDocument());
    // The failed family remains in the picklist; the succeeded one left it
    expect(screen.getByText('Broken Family')).toBeInTheDocument();
    expect(screen.queryByText('Fine Family')).not.toBeInTheDocument();
  });

  it('already-synced rejection AUTO-RECOVERS via key resolution when possible', async () => {
    vi.mocked(setItemBag).mockRejectedValue(new Error('Queued item not found — it may have already synced'));
    vi.mocked(api.get).mockResolvedValue({ id: 'v-recovered' });
    vi.mocked(api.patch).mockResolvedValue({});
    const user = userEvent.setup();
    render(<SummaryScreen families={[fam({ id: '', name: 'RacedFam', visitId: null, queueId: 'q-gone', visitKey: 'vk-race' })]} onNext={() => {}} />);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Save bags/ }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/visits/resolve/vk-race');
      expect(api.patch).toHaveBeenCalledWith('/api/visits/v-recovered/bag', { bag_received: true });
    });
    // Fully recovered: success, no staff-guidance warning
    expect(screen.getByText(/Recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/check-in IS saved/)).not.toBeInTheDocument();
  });

  it('falls back to staff guidance when key resolution fails', async () => {
    vi.mocked(setItemBag).mockRejectedValue(new Error('Queued item not found — it may have already synced'));
    vi.mocked(api.get).mockRejectedValue(new Error('Not found'));
    const user = userEvent.setup();
    render(<SummaryScreen families={[fam({ id: '', name: 'RacedFam', visitId: null, queueId: 'q-gone', visitKey: 'vk-race' })]} onNext={() => {}} />);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Save bags/ }));

    await waitFor(() => expect(screen.getByText(/check-in IS saved/)).toBeInTheDocument());
  });

  it('no false success when nothing was selected-and-saved', async () => {
    const user = userEvent.setup();
    render(<SummaryScreen families={[fam({ id: 'x', name: 'OnlyFam', visitId: null, queueId: null })]} onNext={() => {}} />);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /Save bags/ }));
    await waitFor(() => expect(screen.getByText(/could not be updated/)).toBeInTheDocument());
    expect(screen.queryByText(/✓ Recorded/)).not.toBeInTheDocument();
  });
});
