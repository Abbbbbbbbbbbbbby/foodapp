import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../src/pwa/lib/offline', () => ({
  getPendingCount: vi.fn(async () => 0),
  flushQueue: vi.fn(async () => ({ flushed: 0, errors: 0, deadLettered: 0, needsReLogin: false })),
  getDeadLetters: vi.fn(async () => []),
  deleteDeadLetters: vi.fn(async () => undefined),
}));
vi.mock('../../src/pwa/store/auth', () => ({
  getUser: () => ({ id: 'u1', name: 'Vol One', phone: '4805550001', role: 'volunteer' }),
  getToken: () => 'tok',
  clearAuth: vi.fn(),
}));
vi.mock('../../src/pwa/lib/api', () => ({
  api: { post: vi.fn(), patch: vi.fn(), get: vi.fn() },
  ApiError: class ApiError extends Error { constructor(public status: number, message: string) { super(message); } },
}));

import Layout from '../../src/pwa/components/Layout';
import { getDeadLetters, deleteDeadLetters } from '../../src/pwa/lib/offline';
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
      .mockResolvedValueOnce([dl('d1', 'Shown Family')])       // mount
      .mockResolvedValueOnce([dl('d2', 'Late Family')]);        // re-read after acknowledge
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
