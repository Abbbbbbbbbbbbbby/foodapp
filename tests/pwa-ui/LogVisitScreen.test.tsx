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

import LogVisitScreen from '../../src/pwa/components/enter/LogVisitScreen';
import { api } from '../../src/pwa/lib/api';
import { markDirectoryStale } from '../../src/pwa/lib/offline';
import type { FamilySearchResult } from '../../src/pwa/lib/types';

const family: FamilySearchResult = {
  id: 'fam-1', name: 'Weisel', phone: '4805550001', num_people: 3, last_visit_date: null,
} as unknown as FamilySearchResult;

function renderScreen(onLogVisit = vi.fn(async () => {}), onFamilyUpdated = vi.fn()) {
  render(
    <LogVisitScreen
      family={family}
      total={1}
      current={0}
      onLogVisit={onLogVisit}
      onFamilyUpdated={onFamilyUpdated}
    />
  );
  return { onLogVisit, onFamilyUpdated };
}

describe('LogVisitScreen inline edit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows an Edit button alongside No change, not editable by default', () => {
    renderScreen();
    expect(screen.getByRole('button', { name: /Edit \/ Editar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /No change \/ Sin cambios/ })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Weisel')).not.toBeInTheDocument();
  });

  it('Edit expands a form prefilled with the family\'s current details', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /Edit \/ Editar/ }));

    expect(screen.getByDisplayValue('Weisel')).toBeInTheDocument();
    expect(screen.getByDisplayValue('(480) 555-0001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3')).toBeInTheDocument();
  });

  it('Save PATCHes the family, notifies the parent, marks the directory stale, and closes the form', async () => {
    vi.mocked(api.patch).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    const { onFamilyUpdated } = renderScreen();
    await user.click(screen.getByRole('button', { name: /Edit \/ Editar/ }));

    const nameInput = screen.getByDisplayValue('Weisel');
    await user.clear(nameInput);
    await user.type(nameInput, 'Weisen');
    await user.click(screen.getByRole('button', { name: /Save \/ Guardar/ }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/api/records/families/fam-1', {
        name: 'Weisen', phone: '4805550001', num_people: 3,
      });
    });
    expect(onFamilyUpdated).toHaveBeenCalledWith('fam-1', { name: 'Weisen', phone: '4805550001', num_people: 3 });
    expect(markDirectoryStale).toHaveBeenCalled();
    // Back to the non-editing view, reflecting the save.
    expect(screen.queryByRole('button', { name: /Save \/ Guardar/ })).not.toBeInTheDocument();
    expect(screen.getByText('Weisen')).toBeInTheDocument();
  });

  it('a failed save keeps the form open and shows the error', async () => {
    const { ApiError } = await import('../../src/pwa/lib/api');
    vi.mocked(api.patch).mockRejectedValue(new (ApiError as unknown as new (s: number, m: string) => Error)(403, 'Forbidden'));
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /Edit \/ Editar/ }));
    await user.click(screen.getByRole('button', { name: /Save \/ Guardar/ }));

    expect(await screen.findByText(/Forbidden/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Weisel')).toBeInTheDocument(); // still editing
  });

  it('blocks saving an empty name without a network round trip', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /Edit \/ Editar/ }));
    await user.clear(screen.getByDisplayValue('Weisel'));
    await user.click(screen.getByRole('button', { name: /Save \/ Guardar/ }));

    expect(await screen.findByText(/Name cannot be empty/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('Cancel discards changes without saving', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByRole('button', { name: /Edit \/ Editar/ }));
    const nameInput = screen.getByDisplayValue('Weisel');
    await user.clear(nameInput);
    await user.type(nameInput, 'Wrong Name');
    await user.click(screen.getByRole('button', { name: /Cancel \/ Cancelar/ }));

    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByText('Weisel')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Wrong Name')).not.toBeInTheDocument();
  });
});
