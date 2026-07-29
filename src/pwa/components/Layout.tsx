import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { getUser, clearAuth, getToken } from '../store/auth';
import { getPendingCount } from '../lib/offline';

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

  const isHome = location.pathname === '/';
  const visibleNav = NAV_ITEMS.filter(item => item.roles.includes(user.role));

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
