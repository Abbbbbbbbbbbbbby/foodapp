import { Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearAuth, getToken } from '../store/auth';

export default function Layout() {
  const navigate = useNavigate();
  const user = getUser()!;

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
        <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
