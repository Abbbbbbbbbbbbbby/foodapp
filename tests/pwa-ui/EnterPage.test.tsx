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
  markDirectoryStale: vi.fn(async () => undefined),
  // draft.ts and telemetry.ts (imported transitively by EnterPage) pull
  // these store primitives from lib/offline — without a stub here they'd
  // be undefined, which draft.ts/telemetry.ts's own try/catch wrapping
  // absorbs silently, but stubbing them keeps the mock surface honest and
  // lets a resume-flow test actually observe a draft write.
  putInStore: vi.fn(async () => undefined),
  getFromStore: vi.fn(async () => undefined),
  deleteFromStore: vi.fn(async () => undefined),
  readAllStore: vi.fn(async () => []),
  DRAFT_STORE: 'drafts',
  TELEMETRY_STORE: 'telemetry',
  DB_VERSION: 4,
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

  it('log-visit payloads attribute pickups correctly: own family null, proxy family the NORMALIZED searched phone', async () => {
    vi.mocked(api.get).mockRejectedValue(new TypeError('Failed to fetch'));
    const { directoryPickup } = await import('../../src/pwa/lib/offline');
    vi.mocked(directoryPickup).mockResolvedValue({
      own: { id: 'own', name: 'Mendez Family', name_normalized: 'mendez family', phone: '4805550001', proxy_phones: [], num_people: 3, last_visit_date: null },
      proxy: [
        { id: 'p1', name: 'Vargas Family', name_normalized: 'vargas family', phone: '6025550002', proxy_phones: ['4805550001'], num_people: 5, last_visit_date: null },
      ],
    });
    // Visits go through the identity-PINNED client, not the live api.
    const { apiWithToken } = await import('../../src/pwa/lib/api');
    const pinnedClient = apiWithToken('tok');
    vi.mocked(pinnedClient.post).mockResolvedValue({ id: 'v-x' });
    const user = userEvent.setup();
    render(<EnterPage />);
    const inputs = screen.getAllByRole('textbox');
    // RAW formatted input — the stored phone is normalized; the comparison
    // (and the recorded attribution) must normalize, or a family's OWN
    // pickup is misrecorded as a proxy pickup.
    await user.type(inputs[1], '(480) 555-0001');
    await user.click(screen.getByRole('button', { name: /Search \/ Buscar/ }));

    await screen.findByText(/Select families|Seleccionar familias/);
    // Select BOTH families and confirm.
    await user.click(screen.getByText('Mendez Family'));
    await user.click(screen.getByText('Vargas Family'));
    await user.click(screen.getByRole('button', { name: /Confirm \/ Confirmar \(2\)/ }));

    // Log both visits.
    await user.click(await screen.findByRole('button', { name: /No change \/ Sin cambios/ }));
    await user.click(await screen.findByRole('button', { name: /No change \/ Sin cambios/ }));

    const visitPosts = vi.mocked(pinnedClient.post).mock.calls.filter(c => c[0] === '/api/visits');
    expect(visitPosts).toHaveLength(2);
    const byFamily = Object.fromEntries(visitPosts.map(c => [(c[1] as { family_id: string }).family_id, c[1] as { picked_up_by_phone: string | null }]));
    expect(byFamily['own'].picked_up_by_phone).toBeNull();            // their own pickup
    expect(byFamily['p1'].picked_up_by_phone).toBe('4805550001');     // proxy pickup, normalized
  });

  it('a BROKEN offline cache visibly blocks offline registration — no register-as-new offer', async () => {
    vi.mocked(api.get).mockRejectedValue(new TypeError('Failed to fetch'));
    const { searchDirectory } = await import('../../src/pwa/lib/offline');
    vi.mocked(searchDirectory).mockRejectedValue(new Error('offline storage blocked by another tab — close other tabs of this app'));
    const user = userEvent.setup();
    render(<EnterPage />);
    await searchFor(user, 'Returning Family');

    // The unreadable-roster message, with the actionable tab guidance…
    expect(await screen.findByText(/offline family list is unreadable/)).toBeInTheDocument();
    expect(screen.getByText(/Close other tabs of this app/)).toBeInTheDocument();
    // …and crucially NOT the duplicate-family lane.
    expect(screen.queryByRole('button', { name: /continue and register as new/i })).not.toBeInTheDocument();
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

describe('EnterPage — draft resume prompt', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers to resume a saved draft on mount, and Resume restores the view without a fresh search', async () => {
    const { getFromStore, deleteFromStore } = await import('../../src/pwa/lib/offline');
    vi.mocked(getFromStore).mockResolvedValueOnce({
      user_id: 'u1',
      updatedAt: Date.now(),
      view: {
        type: 'family-select',
        own: { id: 'fam-1', name: 'Resumed Family', phone: null, num_people: 3, last_visit_date: null } as never,
        proxy: [],
        pickupName: 'Resumed Family',
        pickupPhone: null,
      },
      wizard: null,
      pendingFamilies: [],
      pendingVisitIds: [],
    });
    render(<EnterPage />);

    const resumeBtn = await screen.findByRole('button', { name: /^Resume/i });
    expect(screen.getByText(/Resume the unfinished check-in/)).toBeInTheDocument();
    await userEvent.setup().click(resumeBtn);

    // Restored straight into family-select — the family name renders —
    // with no lookup search ever performed.
    expect(await screen.findByText('Resumed Family')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(deleteFromStore).not.toHaveBeenCalled();
  });

  it('Discard clears the draft and stays on the lookup screen', async () => {
    const { getFromStore, deleteFromStore } = await import('../../src/pwa/lib/offline');
    vi.mocked(getFromStore).mockResolvedValueOnce({
      user_id: 'u1',
      updatedAt: Date.now(),
      view: { type: 'how-many', searchName: 'Discard Me', searchPhone: null },
      wizard: null,
      pendingFamilies: [],
      pendingVisitIds: [],
    });
    render(<EnterPage />);

    const discardBtn = await screen.findByRole('button', { name: /^Discard/i });
    await userEvent.setup().click(discardBtn);

    expect(deleteFromStore).toHaveBeenCalled();
    // Still on lookup — the how-many screen never rendered.
    expect(screen.queryByText(/How many families|¿Para cuántas familias/)).not.toBeInTheDocument();
  });

  it('does not offer a resume prompt when no draft exists', async () => {
    render(<EnterPage />);
    await screen.findByRole('button', { name: /Search \/ Buscar/i });
    expect(screen.queryByRole('button', { name: /^Resume/i })).not.toBeInTheDocument();
  });
});
