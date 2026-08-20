import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const draftState = vi.hoisted(() => ({ saved: false }));
vi.mock('../../src/pwa/lib/draft', () => ({
  hasSavedDraft: () => draftState.saved,
}));
const telemetryCalls = vi.hoisted(() => ({
  markBoundaryHandled: vi.fn(),
  trackError: vi.fn(),
  flushTelemetry: vi.fn(async () => undefined),
}));
vi.mock('../../src/pwa/lib/telemetry', () => telemetryCalls);

import ErrorBoundary from '../../src/pwa/components/ErrorBoundary';

function Boom(): never {
  throw new Error('kaboom');
}

beforeEach(() => {
  draftState.saved = false;
  telemetryCalls.markBoundaryHandled.mockClear();
  telemetryCalls.trackError.mockClear();
  telemetryCalls.flushTelemetry.mockClear();
});

describe('ErrorBoundary', () => {
  it('renders children normally when nothing has thrown', () => {
    render(<ErrorBoundary><p>All good</p></ErrorBoundary>);
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('catches a child render error, reports it to telemetry, and keeps the page alive (no crashed subtree, no blank page)', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    consoleSpy.mockRestore();

    expect(telemetryCalls.markBoundaryHandled).toHaveBeenCalledWith(expect.any(Error));
    expect(telemetryCalls.trackError).toHaveBeenCalledWith(expect.any(Error), 'react_boundary');
    expect(telemetryCalls.flushTelemetry).toHaveBeenCalled();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  });

  it('when a draft was saved, shows the honest "entry was saved" banner with a Resume button', async () => {
    draftState.saved = true;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    consoleSpy.mockRestore();

    expect(screen.getByText(/your check-in entry was saved/)).toBeInTheDocument();
    expect(screen.getByText(/su registro se guardó/)).toBeInTheDocument();
    const resumeBtn = screen.getByRole('button', { name: /Resume entry|Continuar registro/i });
    const assignSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign: assignSpy } });
    await userEvent.setup().click(resumeBtn);
    expect(assignSpy).toHaveBeenCalledWith('/enter');
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('when no draft exists, shows the "please reload" banner with a Reload button — never claims data was saved', async () => {
    draftState.saved = false;
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    consoleSpy.mockRestore();

    expect(screen.queryByText(/entry was saved/)).not.toBeInTheDocument();
    expect(screen.getByText(/please reload/i)).toBeInTheDocument();
    const reloadBtn = screen.getByRole('button', { name: /Reload|Recargar/i });
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload: reloadSpy } });
    await userEvent.setup().click(reloadBtn);
    expect(reloadSpy).toHaveBeenCalled();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });
});
