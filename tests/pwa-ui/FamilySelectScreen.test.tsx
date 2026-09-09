import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/pwa/lib/offline', () => ({
  markDirectoryStale: vi.fn(),
}));
vi.mock('../../src/pwa/lib/api', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  return { api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() }, ApiError };
});

import FamilySelectScreen from '../../src/pwa/components/enter/FamilySelectScreen';
import { api } from '../../src/pwa/lib/api';
import { markDirectoryStale } from '../../src/pwa/lib/offline';
import type { FamilySearchResult } from '../../src/pwa/lib/types';

const result = (id: string, name: string): FamilySearchResult => ({
  id, name, phone: null, num_people: 2, last_visit_date: null,
} as unknown as FamilySearchResult);

function renderScreen(onConfirm = vi.fn(), onRegisterNew = vi.fn()) {
  render(
    <FamilySelectScreen
      own={result('own1', 'Own Family')}
      proxy={[]}
      pickupName="Pickup Person"
      pickupPhone="4805550001"
      onConfirm={onConfirm}
      onRegisterNew={onRegisterNew}
      onBack={() => {}}
    />
  );
  return { onConfirm, onRegisterNew };
}

describe('FamilySelectScreen add-another-family', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches, adds pre-checked, and persists the proxy authorization', async () => {
    vi.mocked(api.get).mockResolvedValue({ results: [result('extra1', 'Neighbor Family')] });
    vi.mocked(api.post).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { onConfirm } = renderScreen();

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
    // The new proxy link must reach the offline directory too.
    expect(markDirectoryStale).toHaveBeenCalled();
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
    const { onConfirm } = renderScreen();

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

describe('inline registration launch (probe round 6)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('no-match offers Register-now and passes the query plus current selection', async () => {
    vi.mocked(api.get).mockResolvedValue({ results: [] });
    const user = userEvent.setup();
    const { onRegisterNew } = renderScreen();

    // Build up selection state first so we can prove it survives
    await user.click(screen.getByText('Own Family'));
    await user.click(screen.getByRole('button', { name: /Add another family/ }));
    await user.type(screen.getByPlaceholderText(/Family name/), 'Brand New');
    await user.click(screen.getByRole('button', { name: /Search \/ Buscar/ }));

    await user.click(await screen.findByRole('button', { name: /Register a new family/ }));
    expect(onRegisterNew).toHaveBeenCalledWith('Brand New', {
      extra: [],
      selectedIds: ['own1'],
    });
  });

  it('disables Register-a-new-family if the search box is cleared after results come back', async () => {
    vi.mocked(api.get).mockResolvedValue({ results: [{ id: 'other1', name: 'Someone Else', num_people: 1, last_visit_date: null }] });
    const user = userEvent.setup();
    const { onRegisterNew } = renderScreen();

    await user.click(screen.getByRole('button', { name: /Add another family/ }));
    const input = screen.getByPlaceholderText(/Family name/);
    await user.type(input, 'Partial Match');
    await user.click(screen.getByRole('button', { name: /Search \/ Buscar/ }));
    await screen.findByText('Someone Else'); // results present, none of them right

    await user.clear(input);
    const registerBtn = screen.getByRole('button', { name: /Register a new family/ });
    expect(registerBtn).toBeDisabled();
    await user.click(registerBtn);
    expect(onRegisterNew).not.toHaveBeenCalled();
  });

  it('rehydrates extra families and selection after the round-trip', () => {
    render(
      <FamilySelectScreen
        own={result('own1', 'Own Family')}
        proxy={[]}
        pickupName="Pickup Person"
        pickupPhone="4805550001"
        initialExtra={[result('reg9', 'Freshly Registered')]}
        initialSelected={['own1', 'reg9']}
        notice="Test notice text"
        onConfirm={vi.fn()}
        onRegisterNew={vi.fn()}
        onBack={() => {}}
      />
    );
    expect(screen.getByText('Freshly Registered')).toBeInTheDocument();
    expect(screen.getByText('2 selected / seleccionadas')).toBeInTheDocument();
    expect(screen.getByText('Test notice text')).toBeInTheDocument();
  });
});
