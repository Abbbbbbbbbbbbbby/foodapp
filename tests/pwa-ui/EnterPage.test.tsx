import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/pwa/lib/api', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  const pinnedPost = vi.fn();
  return {
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
    apiWithToken: vi.fn(() => ({ post: pinnedPost, patch: vi.fn() })),
    ApiError,
  };
});
vi.mock('../../src/pwa/store/auth', () => ({
  getAuth: () => ({ token: 'tok', user: { id: 'u1', name: 'Vol One', phone: '4805550001', role: 'volunteer' } }),
  getUser: () => ({ id: 'u1', name: 'Vol One', phone: '4805550001', role: 'volunteer' }),
}));
vi.mock('../../src/pwa/lib/offline', () => ({
  queueItem: vi.fn(async () => 'queue-id-1'),
  generateUUID: () => 'uuid-fixed',
  // SummaryScreen (rendered by EnterPage's done view) imports setItemBag —
  // the mock surface must match the real module or deeper flows throw.
  setItemBag: vi.fn(async () => undefined),
  searchDirectory: vi.fn(async () => []),
  directoryPickup: vi.fn(async () => ({ own: null, proxy: [] })),
  upsertDirectoryFamilies: vi.fn(async () => undefined),
}));

import EnterPage from '../../src/pwa/pages/EnterPage';
import { api, ApiError } from '../../src/pwa/lib/api';
import { searchDirectory } from '../../src/pwa/lib/offline';

async function searchFor(user: ReturnType<typeof userEvent.setup>, name: string) {
  const inputs = screen.getAllByRole('textbox');
  await user.type(inputs[0], name);
  await user.click(screen.getByRole('button', { name: /Search \/ Buscar/ }));
}

describe('EnterPage lookup error routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a server rejection surfaces its message and stays on the lookup', async () => {
    vi.mocked(api.get).mockRejectedValue(new (ApiError as new (s: number, m: string) => Error)(400, 'name or phone is required'));
    const user = userEvent.setup();
    render(<EnterPage />);
    await searchFor(user, 'Garcia');

    expect(await screen.findByText(/name or phone is required/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search \/ Buscar/ })).toBeInTheDocument();
  });

  it('a network failure shows the connectivity message, not a crash', async () => {
    vi.mocked(api.get).mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<EnterPage />);
    await searchFor(user, 'Garcia');

    expect(await screen.findByText(/Network error/)).toBeInTheDocument();
  });

  it('a network failure offers the offline continue path into the wizard', async () => {
    vi.mocked(api.get).mockRejectedValue(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    render(<EnterPage />);
    await searchFor(user, 'Offline Fam');

    // Without this, a dead network strands the volunteer at lookup and the
    // offline queue is unreachable.
    await user.click(await screen.findByRole('button', { name: /continue and register as new/i }));
    expect((await screen.findAllByText(/How many families|¿Para cuántas familias/)).length).toBeGreaterThan(0);
  });

  it('an offline search with a cached directory hit shows the RETURNING household, not register-as-new', async () => {
    vi.mocked(api.get).mockRejectedValue(new TypeError('Failed to fetch'));
    vi.mocked(searchDirectory).mockResolvedValue([
      { id: 'f9', name: 'Garcia Familia', name_normalized: 'garcia familia', phone: null, proxy_phones: [], num_people: 4, last_visit_date: '2026-08-01' },
    ]);
    const user = userEvent.setup();
    render(<EnterPage />);
    await searchFor(user, 'Garcia');

    // Cached roster resolves the household to its EXISTING record — offline
    // register-as-new for a returning family mints a duplicate.
    expect(await screen.findByText(/last synced family list/)).toBeInTheDocument();
    expect(screen.getByText(/Garcia Familia/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue and register as new/i })).not.toBeInTheDocument();
  });

  it('an offline PHONE search keeps pickup semantics: own + proxy families together', async () => {
    vi.mocked(api.get).mockRejectedValue(new TypeError('Failed to fetch'));
    const { directoryPickup } = await import('../../src/pwa/lib/offline');
    vi.mocked(directoryPickup).mockResolvedValue({
      own: { id: 'own', name: 'Mendez Family', name_normalized: 'mendez family', phone: '4805550001', proxy_phones: [], num_people: 3, last_visit_date: null },
      proxy: [
        { id: 'p1', name: 'Vargas Family', name_normalized: 'vargas family', phone: '6025550002', proxy_phones: ['4805550001'], num_people: 5, last_visit_date: null },
        { id: 'p2', name: 'Cruz Family', name_normalized: 'cruz family', phone: '6025550003', proxy_phones: ['4805550001'], num_people: 2, last_visit_date: null },
      ],
    });
    const user = userEvent.setup();
    render(<EnterPage />);
    const inputs = screen.getAllByRole('textbox');
    await user.type(inputs[1], '4805550001'); // phone field
    await user.click(screen.getByRole('button', { name: /Search \/ Buscar/ }));

    // The family-select screen — the same grouping the online pickup flow
    // shows — with ALL linked families, not flat name results.
    expect(await screen.findByText(/Select families|Seleccionar familias/)).toBeInTheDocument();
    expect(screen.getByText('Mendez Family')).toBeInTheDocument();
    expect(screen.getByText('Vargas Family')).toBeInTheDocument();
    expect(screen.getByText('Cruz Family')).toBeInTheDocument();
    expect(screen.getByText(/last synced family list/)).toBeInTheDocument();
  });

  it('a server rejection (not connectivity) does NOT offer the offline path', async () => {
    vi.mocked(api.get).mockRejectedValue(new (ApiError as new (s: number, m: string) => Error)(400, 'bad query'));
    const user = userEvent.setup();
    render(<EnterPage />);
    await searchFor(user, 'Garcia');

    await screen.findByText(/bad query/);
    expect(screen.queryByRole('button', { name: /continue and register as new/i })).not.toBeInTheDocument();
  });

  it('no results routes to the how-many (new family) path', async () => {
    vi.mocked(api.get).mockResolvedValue({ results: [] });
    const user = userEvent.setup();
    render(<EnterPage />);
    await searchFor(user, 'Brand New Person');

    expect((await screen.findAllByText(/How many families|¿Para cuántas familias/)).length).toBeGreaterThan(0);
  });
});
