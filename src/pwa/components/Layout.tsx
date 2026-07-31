import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { getUser, clearAuth, getToken } from '../store/auth';
import { getPendingCount, flushQueue, getDeadLetters, clearDeadLetters } from '../lib/offline';
import type { DeadLetterEntry } from '../lib/offline';
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
  const [deadLetterEntries, setDeadLetterEntries] = useState<DeadLetterEntry[]>([]);

  useEffect(() => {
    function refresh() {
      getPendingCount().then(setPendingCount).catch(() => {});
    }
    refresh();
    window.addEventListener('offlinecountchange', refresh);
    return () => window.removeEventListener('offlinecountchange', refresh);
  }, []);

  useEffect(() => {
    getDeadLetters().then(setDeadLetterEntries).catch(() => {});
  }, []);

  useEffect(() => {
    const apiFn = (url: string, body: unknown) =>
      api.post<unknown>(url, body as Record<string, unknown>);
    const doFlush = async () => {
      try {
        const result = await flushQueue(apiFn);
        // Update dead-letter count from the durable store before any navigation
        if (result.deadLettered > 0) {
          getDeadLetters().then(setDeadLetterEntries).catch(() => {});
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

  async function handleDismissDeadLetters() {
    try { await clearDeadLetters(); } catch { /* best-effort */ }
    setDeadLetterEntries([]);
  }

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
      {deadLetterEntries.length > 0 && (
        <div className="error banner" style={{ margin: 0, borderRadius: 0 }}>
          <p style={{ margin: 0 }}>
            {deadLetterEntries.length} {deadLetterEntries.length === 1 ? 'entry' : 'entries'} could not be saved and {deadLetterEntries.length === 1 ? 'was' : 'were'} removed. Please inform a supervisor.
          </p>
          <ul style={{ margin: '4px 0 4px', paddingLeft: 20 }}>
            {deadLetterEntries.map(e => (
              <li key={e.id}>{e.label} — {e.errorMessage}</li>
            ))}
          </ul>
          <button className="btn-ghost" onClick={handleDismissDeadLetters}>Dismiss</button>
        </div>
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
