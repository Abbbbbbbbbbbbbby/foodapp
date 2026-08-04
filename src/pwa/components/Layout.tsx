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
  const [deadLetters, setDeadLetters] = useState<DeadLetterEntry[]>([]);
  const [dlExpanded, setDlExpanded] = useState(false);

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
    getDeadLetters().then(setDeadLetters).catch(() => {});
  }, []);

  useEffect(() => {
    const apiFn = (url: string, body: unknown, method?: 'POST' | 'PATCH') =>
      method === 'PATCH'
        ? api.patch<unknown>(url, body as Record<string, unknown>)
        : api.post<unknown>(url, body as Record<string, unknown>);
    const doFlush = async () => {
      try {
        const result = await flushQueue(apiFn);
        // Refresh dead-letter entries from the durable store before any navigation
        if (result.deadLettered > 0) {
          getDeadLetters().then(setDeadLetters).catch(() => {});
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

  async function handleAcknowledgeDeadLetters() {
    try {
      await clearDeadLetters();
      setDeadLetters([]);
      setDlExpanded(false);
    } catch { /* keep the banner if the clear failed */ }
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
      {deadLetters.length > 0 && (
        <div className="error banner" style={{ margin: 0, borderRadius: 0, padding: '8px 12px' }}>
          <p style={{ margin: 0 }}>
            {deadLetters.length} {deadLetters.length === 1 ? 'entry' : 'entries'} could not be saved. Show a supervisor before dismissing.
            <button className="btn-ghost" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setDlExpanded(e => !e)}>
              {dlExpanded ? 'Hide' : 'Details'}
            </button>
          </p>
          {dlExpanded && (
            <div style={{ marginTop: 6 }}>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                {deadLetters.map(dl => (
                  <li key={dl.id}>
                    {dl.label} — {new Date(dl.timestamp).toLocaleString()} — server said: {dl.errorStatus} {dl.errorMessage}
                  </li>
                ))}
              </ul>
              <button className="btn-ghost" style={{ marginTop: 6, fontSize: 12 }} onClick={handleAcknowledgeDeadLetters}>
                Acknowledge and dismiss / Confirmar y descartar
              </button>
            </div>
          )}
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
