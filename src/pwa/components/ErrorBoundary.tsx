import { Component, type ReactNode } from 'react';
import { trackError, markBoundaryHandled, flushTelemetry } from '../lib/telemetry';
import { hasSavedDraft } from '../lib/draft';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Wraps <App/> (outside BrowserRouter, so location.assign/reload are used
// for recovery rather than react-router navigation). componentDidCatch marks
// the error so telemetry's chained window.onerror (which React re-fires
// boundary-caught errors to) doesn't double-report it or show a second
// banner. The fallback copy is conditioned on hasSavedDraft(): it must never
// claim an entry was saved unless a draft actually exists.
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    markBoundaryHandled(error);
    trackError(error, 'react_boundary');
    void flushTelemetry();
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    const draftSaved = hasSavedDraft();
    return (
      <div style={{ padding: 24, maxWidth: 480, margin: '40px auto' }}>
        <p className="error banner">
          {draftSaved ? (
            <>
              Something went wrong — your check-in entry was saved. / Algo salió mal — su registro se guardó.
            </>
          ) : (
            <>
              Something went wrong — please reload. / Algo salió mal — recargue la página.
            </>
          )}
        </p>
        {draftSaved ? (
          <button className="btn-primary" onClick={() => { window.location.assign('/enter'); }}>
            Resume entry / Continuar registro
          </button>
        ) : (
          <button className="btn-primary" onClick={() => { window.location.reload(); }}>
            Reload / Recargar
          </button>
        )}
      </div>
    );
  }
}
