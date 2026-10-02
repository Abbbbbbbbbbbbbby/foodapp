import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import ProxyEntryForm from '../../src/pwa/components/enter/ProxyEntryForm';

describe('ProxyEntryForm', () => {
  it('Next is disabled until at least one row has a name', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<ProxyEntryForm onContinue={onContinue} onBack={() => {}} />);

    const nextBtn = screen.getByRole('button', { name: /Next \/ Siguiente/ });
    expect(nextBtn).toBeDisabled();

    await user.type(screen.getByLabelText(/^Name \/ Nombre/), 'Someone');
    expect(nextBtn).not.toBeDisabled();
  });

  it('strips blank rows and treats phone as optional on Continue', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<ProxyEntryForm onContinue={onContinue} onBack={() => {}} />);

    await user.type(screen.getByLabelText(/^Name \/ Nombre/), 'Filled Row');
    await user.click(screen.getByRole('button', { name: /\+ Add another person/ }));
    // Second row left entirely blank.
    await user.click(screen.getByRole('button', { name: /Next \/ Siguiente/ }));

    expect(onContinue).toHaveBeenCalledWith([{ name: 'Filled Row', phone: null }]);
  });

  it('+ Add another person adds another row, and multiple filled rows all come through', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<ProxyEntryForm onContinue={onContinue} onBack={() => {}} />);

    await user.type(screen.getByLabelText(/^Name \/ Nombre/), 'First');
    await user.click(screen.getByRole('button', { name: /\+ Add another person/ }));
    const nameInputs = screen.getAllByLabelText(/^Name \/ Nombre/);
    expect(nameInputs).toHaveLength(2);
    await user.type(nameInputs[1], 'Second');
    const phoneInputs = screen.getAllByLabelText(/^Phone/);
    await user.type(phoneInputs[1], '6025559999');
    await user.click(screen.getByRole('button', { name: /Next \/ Siguiente/ }));

    expect(onContinue).toHaveBeenCalledWith([
      { name: 'First', phone: null },
      { name: 'Second', phone: '(602) 555-9999' },
    ]);
  });
});
