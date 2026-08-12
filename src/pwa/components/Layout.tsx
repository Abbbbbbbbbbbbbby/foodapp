import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { getUser, clearAuth, getToken } from '../store/auth';
import { getPendingCount, flushQueue, getDeadLetters, deleteDeadLetters, adoptForeignItems } from '../lib/offline';
import type { DeadLetterEntry } from '../lib/offline';
import { apiWithToken } from '../lib/api';

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
  const [sessionExpired, setSessionExpired] = useState(false);
  const [syncBroken, setSyncBroken] = useState(false);
  const [foreignCount, setForeignCount] = useState(0);
  const [adoptArmed, setAdoptArmed] = useState(false);

  useEffect(() => {
    function refresh() {
      getPendingCount().then(setPendingCount).catch((err) => console.error('pending-count read failed:', err));
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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const doFlush = async () => {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
      try {
        // Pin the token for the WHOLE flush: one queued submission spans
        // several requests, and reading the live token per request would let
        // a mid-flush account switch split it across two identities.
        const pinned = apiWithToken(getToken());
        const apiFn = (url: string, body: unknown, method?: 'POST' | 'PATCH') =>
          method === 'PATCH'
            ? pinned.patch<unknown>(url, body as Record<string, unknown>)
            : pinned.post<unknown>(url, body as Record<string, unknown>);
        const result = await flushQueue(apiFn, user.id);
        // A skipped result means another flush was already in flight — it
        // says nothing about queue health, so it must not clear warning
        // banners. The in-flight flush may belong to an UNMOUNTED Layout
        // whose setState is dead, so re-check shortly: THIS component must
        // be the one that surfaces the real results.
        if (result.skipped) {
          if (!disposed) retryTimer = setTimeout(doFlush, 5_000);
          return;
        }
        setSyncBroken(false);
        setForeignCount(result.foreignItems);
        if (result.errors > 0) {
          console.warn(`offline sync: ${result.errors} item(s) failed transiently — retrying in 30s`);
          // Mount and 'online' are not enough: a 503 or transient fetch
          // failure while the browser STAYS online needs a scheduled retry.
          if (!disposed) retryTimer = setTimeout(doFlush, 30_000);
        }
        // Refresh dead letters UNCONDITIONALLY: entries may have been written
        // by an earlier flush whose component unmounted before rendering them,
        // so this flush's own deadLettered count can't gate the read.
        getDeadLetters().then(setDeadLetters).catch((err) => {
          // Failing to show just-dead-lettered entries would read as
          // "synced". Surface the degraded state.
          console.error('failed to load dead-letter entries after flush:', err);
          setSyncBroken(true);
        });
        if (result.needsReLogin) {
          // Never yank mid-work: a stale queued item's 401 used to clearAuth
          // and redirect from any page, losing in-progress entry (issue #6).
          setSessionExpired(true);
        }
      } catch (err) {
        // Broken IndexedDB (or a flush bug): visible, not just tail-able.
        console.error('offline sync unavailable:', err);
        setSyncBroken(true);
      }
    };
    // Items queued while already online (e.g. a request that failed over live
    // wifi) get a near-term flush instead of waiting for a connectivity event.
    let queuedTimer: ReturnType<typeof setTimeout> | undefined;
    const onCountChange = () => {
      if (navigator.onLine === false) return;
      if (queuedTimer) clearTimeout(queuedTimer);
      queuedTimer = setTimeout(doFlush, 5_000);
    };
    doFlush();
    window.addEventListener('online', doFlush);
    window.addEventListener('offlinecountchange', onCountChange);
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (queuedTimer) clearTimeout(queuedTimer);
      window.removeEventListener('online', doFlush);
      window.removeEventListener('offlinecountchange', onCountChange);
    };
  }, [navigate]);

  async function handleAcknowledgeDeadLetters() {
    try {
      // Delete only the entries currently shown; anything that landed after
      // this render stays and re-renders the banner.
      await deleteDeadLetters(deadLetters.map(dl => dl.id));
      const remaining = await getDeadLetters();
      setDeadLetters(remaining);
      if (remaining.length === 0) setDlExpanded(false);
    } catch { /* keep the banner if the clear failed */ }
  }

  async function handleAdoptForeign() {
    try {
      await adoptForeignItems(user.id);
      setForeignCount(0);
      setAdoptArmed(false);
      // adoptForeignItems dispatched offlinecountchange, which schedules the
      // flush that syncs the adopted entries under this account.
    } catch (err) {
      console.error('failed to adopt held entries:', err);
      setSyncBroken(true);
    }
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
      {sessionExpired && (
        <div className="error banner" style={{ margin: 0, borderRadius: 0, padding: '8px 12px' }}>
          <p style={{ margin: 0 }}>
            Session expired — queued entries are safe and will sync after you sign in again. / Sesión expirada — las entradas guardadas se sincronizarán al volver a iniciar sesión.
            <button className="btn-ghost" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => { clearAuth(); navigate('/login'); }}>
              Sign in / Iniciar sesión
            </button>
          </p>
        </div>
      )}
      {syncBroken && (
        <div className="error banner" style={{ margin: 0, borderRadius: 0, padding: '8px 12px' }}>
          <p style={{ margin: 0 }}>
            Offline sync is unavailable on this device — do not rely on offline entry. Tell a supervisor. / La sincronización sin conexión no está disponible en este dispositivo.
          </p>
        </div>
      )}
      {foreignCount > 0 && (
        <div className="error banner" style={{ margin: 0, borderRadius: 0, padding: '8px 12px' }}>
          <p style={{ margin: 0 }}>
            {foreignCount} entr{foreignCount === 1 ? 'y' : 'ies'} from a different account {foreignCount === 1 ? 'is' : 'are'} waiting — that person should sign in on this device to sync them.
            {/* Recovery path when the owner CAN'T sign in again (deactivated
                account): deliberately re-attribute to the current user. Two
                clicks, because it trades attribution accuracy for the data. */}
            {!adoptArmed ? (
              <button className="btn-ghost" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setAdoptArmed(true)}>
                Can't sign in? Sync under my account… / ¿No puede? Sincronizar en mi cuenta…
              </button>
            ) : (
              <>
                <button className="btn-ghost" style={{ marginLeft: 8, fontSize: 12 }} onClick={handleAdoptForeign}>
                  Confirm: record {foreignCount === 1 ? 'this entry' : 'these entries'} as mine / Confirmar
                </button>
                <button className="btn-ghost" style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setAdoptArmed(false)}>
                  Cancel / Cancelar
                </button>
              </>
            )}
          </p>
        </div>
      )}
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
                  <li key={dl.id} style={{ marginBottom: 6 }}>
                    {dl.label} — {new Date(dl.timestamp).toLocaleString()} — server said: {dl.errorStatus} {dl.errorMessage}
                    {/* Full stored submission — this is the recoverable copy; a
                        supervisor re-enters from it (or exports it) before dismissing. */}
                    <pre style={{ margin: '4px 0 0', padding: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: 'rgba(0,0,0,0.15)', borderRadius: 4, maxHeight: 120, overflowY: 'auto' }}>
                      {JSON.stringify(dl.payload, null, 1)}
                    </pre>
                  </li>
                ))}
              </ul>
              <button
                className="btn-ghost"
                style={{ marginTop: 6, fontSize: 12, marginRight: 8 }}
                onClick={() => {
                  const blob = new Blob([JSON.stringify(deadLetters, null, 2)], { type: 'application/json' });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = `unsaved-entries-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(a.href);
                }}
              >
                Download copy / Descargar copia
              </button>
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
