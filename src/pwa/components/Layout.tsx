import { useState, useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearAuth, getToken } from '../store/auth';
import { getPendingCount } from '../lib/offline';

export default function Layout() {
  const navigate = useNavigate();
  const user = getUser()!;
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    function refresh() {
      getPendingCount().then(setPendingCount).catch(() => {});
    }
    refresh();
    window.addEventListener('offlinecountchange', refresh);
    return () => window.removeEventListener('offlinecountchange', refresh);
  }, []);

  async function handleLogout() {
    try {
      const token = getToken();
      await fetch('/api/auth/logout', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch { /* ignore network errors on logout */ }
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="layout">
      <header className="header">
        <span className="header-name">{user.name}</span>
        {pendingCount > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 8 }}>
            {pendingCount} pending sync
          </span>
        )}
        <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
