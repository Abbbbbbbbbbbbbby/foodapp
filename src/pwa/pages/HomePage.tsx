import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../store/auth';
import { api } from '../lib/api';

export default function HomePage() {
  const navigate = useNavigate();
  const user = getUser()!;
  const [bootstrapState, setBootstrapState] = useState<'idle' | 'busy' | 'done' | 'taken'>('idle');

  async function handleBootstrap() {
    setBootstrapState('busy');
    try {
      await api.post('/api/admin/bootstrap', {});
      setBootstrapState('done');
      setTimeout(() => {
        clearAuth();
        navigate('/login');
      }, 2500);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 403) {
        setBootstrapState('taken');
      } else {
        setBootstrapState('idle');
        alert(err instanceof Error ? err.message : 'Something went wrong');
      }
    }
  }

  return (
    <div className="home-page">
      <h1>Welcome, {user.name}</h1>
      <div className="home-buttons">
        <button className="btn-primary btn-large" onClick={() => navigate('/enter')}>
          Enter Data / Ingresar datos
        </button>
        {(user.role === 'staff' || user.role === 'admin') && (
          <button className="btn-secondary btn-large" disabled>
            View Records / Ver registros (coming soon)
          </button>
        )}
        {user.role === 'admin' && (
          <button className="btn-secondary btn-large" onClick={() => navigate('/admin/accounts')}>
            Manage Accounts
          </button>
        )}
      </div>

      {user.role !== 'admin' && (
        <div className="bootstrap-section">
          {bootstrapState === 'idle' && (
            <button className="btn-ghost bootstrap-btn" onClick={handleBootstrap}>
              Claim admin access
            </button>
          )}
          {bootstrapState === 'busy' && (
            <p className="bootstrap-msg">Claiming…</p>
          )}
          {bootstrapState === 'done' && (
            <p className="bootstrap-msg bootstrap-success">
              You're now an admin. Logging you out so the new role takes effect…
            </p>
          )}
          {bootstrapState === 'taken' && (
            <p className="bootstrap-msg bootstrap-taken">
              An admin already exists — ask them to grant you access from Manage Accounts.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
