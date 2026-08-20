import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import Wizard, { TextsStep } from '../../src/pwa/components/wizard/Wizard';

function renderWizard(onComplete = vi.fn(async () => {})) {
  render(
    <Wizard
      familyIndex={0}
      total={1}
      initialData={{ name: 'Prefilled Person', phone: '4805550001' }}
      proxyData={null}
      onComplete={onComplete}
      onBack={() => {}}
    />
  );
  return onComplete;
}

describe('Wizard', () => {
  it('starts on step 1 with prefilled name and bilingual question text', () => {
    renderWizard();
    expect(screen.getByText(/Step 1 of 11/)).toBeInTheDocument();
    expect(screen.getByText(/full name of the person receiving the food/)).toBeInTheDocument();
    expect(screen.getByText(/nombre completo de la persona que recibe los alimentos/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Prefilled Person')).toBeInTheDocument();
  });

  it('advances through steps and shows the progress counter', async () => {
    const user = userEvent.setup();
    renderWizard();
    // Step 1 name is prefilled — continue
    await user.click(screen.getByRole('button', { name: /Next|Continue|Siguiente/i }));
    expect(await screen.findByText(/Step 2 of 11/)).toBeInTheDocument();
    expect(screen.getAllByText(/phone number|número de teléfono/i).length).toBeGreaterThan(0);
  });

  it('back returns to the previous step without losing entered data', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(screen.getByRole('button', { name: /Next|Continue|Siguiente/i }));
    await screen.findByText(/Step 2 of 11/);
    await user.click(screen.getAllByRole('button', { name: /Back|Atrás/i })[0]);
    expect(await screen.findByText(/Step 1 of 11/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Prefilled Person')).toBeInTheDocument();
  });

  it('TextsStep: No leads to the updates question; answering Yes completes with (false, true)', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<TextsStep language="en" onComplete={onComplete} onBack={() => {}} />);

    expect(screen.getByText(/Do you currently receive weekly text messages/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^No$/ }));
    expect(await screen.findByText(/Would you like to receive weekly text updates/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Yes/ }));
    expect(onComplete).toHaveBeenCalledWith(false, true);
  });

  it('TextsStep: answering Yes to already-receiving completes immediately with (true, null)', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<TextsStep language="en" onComplete={onComplete} onBack={() => {}} />);
    await user.click(screen.getByRole('button', { name: /Yes/ }));
    expect(onComplete).toHaveBeenCalledWith(true, null);
    expect(screen.queryByText(/Would you like to receive weekly text updates/)).not.toBeInTheDocument();
  });

  it('initialStep seeds the wizard past step 1 (draft resume)', () => {
    render(
      <Wizard
        familyIndex={0}
        total={1}
        initialData={{ name: 'Resumed Person', phone: '4805550001' }}
        initialStep={4}
        proxyData={null}
        onComplete={vi.fn()}
        onBack={() => {}}
      />
    );
    expect(screen.getByText(/Step 5 of 11/)).toBeInTheDocument();
  });

  it('onStateChange fires with the current (0-based) step and data on mount and on advance', async () => {
    const user = userEvent.setup();
    const onStateChange = vi.fn();
    render(
      <Wizard
        familyIndex={0}
        total={1}
        initialData={{ name: 'Prefilled Person' }}
        proxyData={null}
        onComplete={vi.fn()}
        onBack={() => {}}
        onStateChange={onStateChange}
      />
    );
    await waitFor(() => {
      expect(onStateChange).toHaveBeenCalledWith(0, expect.objectContaining({ name: 'Prefilled Person' }));
    });
    onStateChange.mockClear();
    await user.click(screen.getByRole('button', { name: /Next|Continue|Siguiente/i }));
    await waitFor(() => {
      expect(onStateChange).toHaveBeenCalledWith(1, expect.anything());
    });
  });

  it('a matching __throwAtWizardStep (1-based) throws during render', () => {
    window.__throwAtWizardStep = 1; // step index 0 → displayed "Step 1"
    // Swallow React's expected error-boundary console noise for this render.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderWizard()).toThrow(/e2e test hook/);
    consoleSpy.mockRestore();
    delete window.__throwAtWizardStep;
  });
});
