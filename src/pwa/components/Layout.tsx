import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { getUser, clearAuth, getToken } from '../store/auth';
import { getPendingCount, flushQueue, getDeadLetters } from '../lib/offline';
import { api } from '../lib/api';

interface NavItem {
  label: string;
  path: string;
  roles: ('admin' | 'staff' | 'volunteer')[];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Home',               path: '/',                  roles: ['admin', 'staff', 'volunteer'] },
  { label: 'Enter Data',         path: '/enter',             roles: ['admin', 'staff', 'volunteer'] },
  { label: 'View Records',       path: '/records',           roles: ['admin', 'staff'] },
  { label: 'Manage Accounts',    path: '/admin/accounts',    roles: ['admin'] },
  { label: 'Import from Bubble', path: '/admin/import',      roles: ['admin'] },
  { label: 'Review Duplicates',  path: '/admin/duplicates',  roles: ['admin'] },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser()!;
  const [pendingCount, setPendingCount] = useState(0);
  const [deadLetterCount, setDeadLetterCount] = useState(0);

  useEffect(() => {
    function refresh() {
      getPendingCount().then(setPendingCount).catch(() => {});
    }
    refresh();
    window.addEventListener('offlinecountchange', refresh);
    return () => window.removeEventListener('offlinecountchange', refresh);
  }, []);

  useEffect(() => {
    // Load any persisted dead-letter entries on mount
    getDeadLetters().then(entries => setDeadLetterCount(entries.length)).catch(() => {});
  }, []);

  useEffect(() => {
    const apiFn = (url: string, body: unknown) =>
      api.post<unknown>(url, body as Record<string, unknown>);
    const doFlush = async () => {
      try {
        const result = await flushQueue(apiFn);
        // Update dead-letter count from the durable store before any navigation
        if (result.deadLettered > 0) {
          getDeadLetters().then(entries => setDeadLetterCount(entries.length)).catch(() => {});
        }
        if (result.needsReLogin) {
          clearAuth();
          navigate('/login');
        }
      } catch { /* IndexedDB unavailable — degrade silently */ }
    };
    doFlush();
    window.addEventListener('online', doFlush);
    return () => window.removeEventListener('online', doFlush);
  }, [navigate]);

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

  const isHome = location.pathname === '/';
  const visibleNav = NAV_ITEMS.filter(item => item.roles.includes(user.role));

  return (
    <div className="layout">
      {deadLetterCount > 0 && (
        <p className="error banner" style={{ margin: 0, borderRadius: 0 }}>
          {deadLetterCount} {deadLetterCount === 1 ? 'entry' : 'entries'} could not be saved and {deadLetterCount === 1 ? 'was' : 'were'} removed. Please inform a supervisor.
        </p>
      )}
      <header className="header">
        <span className="header-name">{user.name}</span>
        {pendingCount > 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 8 }}>
            {pendingCount} pending sync
          </span>
        )}
        <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
      </header>

      {!isHome && (
        <nav className="app-nav">
          {visibleNav.map(item => (
            <button
              key={item.path}
              className={'app-nav-item' + (location.pathname === item.path ? ' app-nav-active' : '')}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
