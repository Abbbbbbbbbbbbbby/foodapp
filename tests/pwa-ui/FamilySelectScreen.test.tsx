import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/pwa/lib/api', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  return { api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() }, ApiError };
});

import FamilySelectScreen from '../../src/pwa/components/enter/FamilySelectScreen';
import { api } from '../../src/pwa/lib/api';
import type { FamilySearchResult } from '../../src/pwa/lib/types';

const result = (id: string, name: string): FamilySearchResult => ({
  id, name, phone: null, num_people: 2, last_visit_date: null,
} as unknown as FamilySearchResult);

function renderScreen(onConfirm = vi.fn()) {
  render(
    <FamilySelectScreen
      own={result('own1', 'Own Family')}
      proxy={[]}
      pickupName="Pickup Person"
      pickupPhone="4805550001"
      onConfirm={onConfirm}
      onBack={() => {}}
    />
  );
  return onConfirm;
}

describe('FamilySelectScreen add-another-family', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches, adds pre-checked, and persists the proxy authorization', async () => {
    vi.mocked(api.get).mockResolvedValue({ results: [result('extra1', 'Neighbor Family')] });
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const onConfirm = renderScreen();

    await user.click(screen.getByRole('button', { name: /Add another family/ }));
    await user.type(screen.getByPlaceholderText(/Family name/), 'Neighbor');
    await user.click(screen.getByRole('button', { name: /Search \/ Buscar/ }));
    await user.click(await screen.findByText('Neighbor Family'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/families/extra1/proxies', {
        proxy_name: 'Pickup Person',
        proxy_phone: '4805550001',
      });
    });
    // Added pre-checked: confirm includes it
    await user.click(screen.getByRole('button', { name: /Confirm/ }));
    expect(onConfirm).toHaveBeenCalledWith([expect.objectContaining({ id: 'extra1' })]);
  });

  it('keeps the panel and error visible when proxy persistence fails', async () => {
    const { ApiError } = await import('../../src/pwa/lib/api');
    vi.mocked(api.get).mockResolvedValue({ results: [result('extra2', 'Failing Family')] });
    vi.mocked(api.post).mockRejectedValue(new (ApiError as unknown as new (s: number, m: string) => Error)(500, 'server down'));
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /Add another family/ }));
    await user.type(screen.getByPlaceholderText(/Family name/), 'Failing');
    await user.click(screen.getByRole('button', { name: /Search \/ Buscar/ }));
    await user.click(await screen.findByText('Failing Family'));

    // Panel stays open (Cancel button still present) with the visible warning
    await waitFor(() => expect(screen.getByText(/couldn't be saved for next time/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
    // Family still added to the pickup despite persistence failure
    expect(screen.getAllByText('Failing Family').length).toBeGreaterThan(0);
  });

  it('no-match shows the register-later guidance', async () => {
    vi.mocked(api.get).mockResolvedValue({ results: [] });
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /Add another family/ }));
    await user.type(screen.getByPlaceholderText(/Family name/), 'Nobody');
    await user.click(screen.getByRole('button', { name: /Search \/ Buscar/ }));

    expect(await screen.findByText(/No match found/)).toBeInTheDocument();
  });

  it('cannot double-add the same family', async () => {
    vi.mocked(api.get).mockResolvedValue({ results: [result('dup1', 'Dup Family')] });
    let release!: () => void;
    vi.mocked(api.post).mockImplementation(() => new Promise(r => { release = () => r({ ok: true }); }));
    const user = userEvent.setup();
    const onConfirm = renderScreen();

    await user.click(screen.getByRole('button', { name: /Add another family/ }));
    await user.type(screen.getByPlaceholderText(/Family name/), 'Dup');
    await user.click(screen.getByRole('button', { name: /Search \/ Buscar/ }));
    const card = await screen.findByText('Dup Family');
    await user.click(card);
    await user.click(card); // second tap during the in-flight POST
    release();

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /Confirm/ }));
    const selected = onConfirm.mock.calls[0][0] as { id: string }[];
    expect(selected.filter(f => f.id === 'dup1')).toHaveLength(1);
  });
});
