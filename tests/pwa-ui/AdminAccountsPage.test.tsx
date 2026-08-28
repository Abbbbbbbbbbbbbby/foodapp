import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../src/pwa/lib/api', () => {
  class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
  return {
    api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    ApiError,
  };
});
vi.mock('../../src/pwa/store/auth', () => ({
  getUser: () => ({ id: 'me', name: 'Me Admin', phone: '4805550000', role: 'admin' }),
}));

import AdminAccountsPage from '../../src/pwa/pages/AdminAccountsPage';
import { api } from '../../src/pwa/lib/api';

const BOB = {
  id: 'u1', name: 'Bob', phone: '4805550002', role: 'volunteer', active: true,
  self_registered: true, created_at: '2026-01-01T00:00:00Z',
  last_family_name: null, last_family_at: null, last_visit_date: null,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminAccountsPage />
    </MemoryRouter>
  );
}

describe('AdminAccountsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/api/admin/users') return Promise.resolve({ users: [BOB] });
      throw new Error('unexpected GET ' + path);
    });
  });

  it('edits name and phone, sending them via PATCH and reloading', async () => {
    vi.mocked(api.patch).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Bob');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByPlaceholderText('Name');
    const phoneInput = screen.getByPlaceholderText('Phone');
    await user.clear(nameInput);
    await user.type(nameInput, 'Bobby');
    await user.clear(phoneInput);
    await user.type(phoneInput, '(480) 555-0099');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/admin/users/u1', { name: 'Bobby', phone: '(480) 555-0099' }));
    // Reloads the list after a successful save (server normalizes the phone).
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('shows a PATCH error inline and stays in edit mode', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('Phone number is already in use by another account'));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Bob');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Phone number is already in use by another account')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Name')).toBeInTheDocument(); // still editing
  });

  it('deletes without data by default', async () => {
    vi.mocked(api.delete).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Bob');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/admin/users/u1'));
  });

  it('checking "also delete data" fetches and shows a count, and gates deletion on typing the name', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/api/admin/users') return Promise.resolve({ users: [BOB] });
      if (path === '/api/admin/users/u1/data-summary') return Promise.resolve({ families: 3, visits: 7 });
      throw new Error('unexpected GET ' + path);
    });
    vi.mocked(api.delete).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Bob');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('checkbox'));

    expect(await screen.findByText(/permanently delete 3 families and 7 visits/)).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Yes, delete account and all its data/ });
    expect(confirmBtn).toBeDisabled();

    const nameInput = screen.getByPlaceholderText('Type "Bob" to confirm');
    await user.type(nameInput, 'bob'); // case-insensitive
    expect(confirmBtn).toBeEnabled();

    await user.click(confirmBtn);
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/admin/users/u1?deleteData=1'));
  });

  it('mistyping the confirmation name keeps the delete-with-data button disabled', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/api/admin/users') return Promise.resolve({ users: [BOB] });
      if (path === '/api/admin/users/u1/data-summary') return Promise.resolve({ families: 1, visits: 1 });
      throw new Error('unexpected GET ' + path);
    });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Bob');

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('checkbox'));
    await screen.findByPlaceholderText('Type "Bob" to confirm');

    const nameInput = screen.getByPlaceholderText('Type "Bob" to confirm');
    await user.type(nameInput, 'Bobb');
    expect(screen.getByRole('button', { name: /Yes, delete account and all its data/ })).toBeDisabled();
  });
});
