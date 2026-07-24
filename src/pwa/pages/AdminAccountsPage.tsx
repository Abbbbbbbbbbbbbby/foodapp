import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { getUser } from '../store/auth';

type Role = 'admin' | 'staff' | 'volunteer';

interface AdminUser {
  id: string;
  name: string;
  phone: string;
  role: Role;
  active: boolean;
  self_registered: boolean;
  created_at: string;
  last_family_name: string | null;
  last_family_at: string | null;
  last_visit_date: string | null;
}

function rolePillStyle(role: Role): React.CSSProperties {
  const colors: Record<Role, string> = {
    admin: 'var(--accent)',
    staff: '#4a90e2',
    volunteer: 'var(--text-muted)',
  };
  return {
    display: 'inline-block',
    background: colors[role],
    color: role === 'admin' ? '#000' : '#fff',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    padding: '2px 8px',
    borderRadius: 4,
  };
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function lastActivity(u: AdminUser): string {
  if (u.last_family_name && u.last_family_at) {
    return 'Added ' + u.last_family_name + ' on ' + formatDate(u.last_family_at);
  }
  if (u.last_visit_date) {
    return 'Last visit: ' + formatDate(u.last_visit_date);
  }
  return 'No data entered yet';
}

export default function AdminAccountsPage() {
  const navigate = useNavigate();
  const me = getUser()!;
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.get<{ users: AdminUser[] }>('/api/admin/users')
      .then(data => setUsers(data.users))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const filterLower = filter.toLowerCase();
  const visible = users.filter(u =>
    !filterLower ||
    u.name.toLowerCase().indexOf(filterLower) !== -1 ||
    u.phone.indexOf(filterLower) !== -1
  );

  async function changeRole(userId: string, role: Role) {
    setBusy(b => ({ ...b, [userId]: true }));
    try {
      await api.patch('/api/admin/users/' + userId, { role });
      setUsers(us => us.map(u => u.id === userId ? { ...u, role } : u));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setBusy(b => ({ ...b, [userId]: false }));
    }
  }

  async function toggleActive(userId: string, active: boolean) {
    setBusy(b => ({ ...b, [userId]: true }));
    try {
      await api.patch('/api/admin/users/' + userId, { active });
      setUsers(us => us.map(u => u.id === userId ? { ...u, active } : u));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setBusy(b => ({ ...b, [userId]: false }));
    }
  }

  async function deleteUser(userId: string) {
    setBusy(b => ({ ...b, [userId]: true }));
    try {
      await api.delete('/api/admin/users/' + userId);
      setUsers(us => us.filter(u => u.id !== userId));
      setConfirmDelete(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete');
      setBusy(b => ({ ...b, [userId]: false }));
    }
  }

  return (
    <div className="admin-accounts">
      <div className="admin-header">
        <button className="btn-ghost admin-back" onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1 className="admin-title">Manage Accounts</h1>
        <span className="admin-count">{users.length} users</span>
      </div>

      {error && (
        <p className="admin-error">{error}</p>
      )}

      {!loading && (
        <div className="admin-search-wrap">
          <input
            type="text"
            className="admin-search"
            placeholder="Search by name or phone"
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
        </div>
      )}

      {loading && <p className="admin-loading">Loading…</p>}

      <ul className="admin-user-list">
        {visible.map(u => (
          <li
            key={u.id}
            className={'admin-user-card' + (u.active ? '' : ' admin-user-inactive')}
          >
            <div className="admin-user-top">
              <div className="admin-user-avatar">
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div className="admin-user-info">
                <div className="admin-user-name-row">
                  <span className="admin-user-name">{u.name}</span>
                  <span style={rolePillStyle(u.role)}>{u.role}</span>
                  {!u.active && <span className="admin-user-inactive-badge">inactive</span>}
                </div>
                <div className="admin-user-phone">{u.phone}</div>
                <div className="admin-user-activity">{lastActivity(u)}</div>
                <div className="admin-user-meta">
                  {u.self_registered ? 'Self-registered' : 'Admin-created'} ·{' '}
                  {formatDate(u.created_at)}
                </div>
              </div>
            </div>

            <div className="admin-user-actions">
              <div className="admin-role-wrap">
                <label className="admin-role-label">Role</label>
                <select
                  className="admin-role-select"
                  value={u.role}
                  disabled={busy[u.id] || u.id === me.id}
                  onChange={e => changeRole(u.id, e.target.value as Role)}
                >
                  <option value="volunteer">Volunteer</option>
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="admin-action-row">
                {u.id !== me.id && (
                  <button
                    className={'admin-deactivate-btn' + (u.active ? '' : ' admin-reactivate-btn')}
                    disabled={busy[u.id]}
                    onClick={() => toggleActive(u.id, !u.active)}
                  >
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}

                {u.id !== me.id && confirmDelete !== u.id && (
                  <button
                    className="admin-delete-btn"
                    disabled={busy[u.id]}
                    onClick={() => setConfirmDelete(u.id)}
                  >
                    Delete
                  </button>
                )}

                {confirmDelete === u.id && (
                  <div className="admin-confirm-row">
                    <span className="admin-confirm-text">Delete {u.name}?</span>
                    <button
                      className="admin-confirm-yes"
                      disabled={busy[u.id]}
                      onClick={() => deleteUser(u.id)}
                    >
                      {busy[u.id] ? 'Deleting…' : 'Yes, delete'}
                    </button>
                    <button
                      className="admin-confirm-cancel"
                      onClick={() => setConfirmDelete(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!loading && visible.length === 0 && (
        <p className="admin-empty">
          {filter ? 'No users match "' + filter + '"' : 'No users found.'}
        </p>
      )}
    </div>
  );
}
