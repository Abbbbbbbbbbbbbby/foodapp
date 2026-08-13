import { useState, useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { getUser, getAuth, clearAuth, getToken, AUTH_STORAGE_KEY } from '../store/auth';
import { getPendingCount, flushQueue, getDeadLetters, deleteDeadLetters, adoptForeignItems, cacheDirectory } from '../lib/offline';
import type { DirectoryFamily } from '../lib/offline';
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
  // Mount-time identity, deliberately NOT re-read on re-render: this Layout
  // instance belongs to whoever opened it. A live getUser() here would shift
  // the comparison baseline the moment another tab rewrites the auth blob
  // (and a cross-tab sign-out would make it null mid-render).
  const [user] = useState(() => getUser()!);
  const [pendingCount, setPendingCount] = useState(0);
  const [deadLetters, setDeadLetters] = useState<DeadLetterEntry[]>([]);
  const [dlExpanded, setDlExpanded] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [syncBroken, setSyncBroken] = useState(false);
  const [foreignCount, setForeignCount] = useState(0);
  const [adoptArmed, setAdoptArmed] = useState(false);
  // Feature-tested once: Safari gained service workers in 11.1 (iOS 11.3);
  // the documented iPad 2 / iOS 9.3.5 target has none, so a reload or
  // cold start during an outage cannot restore the app there. Say so
  // instead of letting the device silently fail to a white screen.
  const [swSupported] = useState(() => 'serviceWorker' in navigator);
  // Cross-tab identity change: 'signed-out', or the new user's name.
  const [accountChanged, setAccountChanged] = useState<{ name: string } | 'signed-out' | null>(null);

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
    // Refresh the offline family directory while we HAVE a connection — it
    // is what lets a returning household be found during a later outage
    // instead of being re-registered as a duplicate.
    if (navigator.onLine === false) return;
    const auth = getAuth();
    if (!auth) return;
    apiWithToken(auth.token).get<{ families: DirectoryFamily[] }>('/api/families/directory')
      .then(r => cacheDirectory(r.families))
      .catch(err => console.warn('family directory refresh failed (offline lookup will use the last cached copy):', err));
  }, []);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // Real modality, not just aria-modal: without this, focus stays on
    // whatever wizard button the volunteer last touched, and Enter fires
    // the handler BEHIND the overlay — submitting the old draft under the
    // newly signed-in account. Move focus in, contain Tab, and recapture
    // anything that escapes (works without `inert`, which the iOS 9 target
    // lacks).
    if (!accountChanged) return;
    const dialog = overlayRef.current;
    if (!dialog) return;
    const focusDialog = () => {
      (dialog.querySelector('button') ?? dialog).focus();
    };
    focusDialog();
    const onFocusIn = (e: FocusEvent) => {
      if (!dialog.contains(e.target as Node)) focusDialog();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      // The dialog has a single focusable control — keep focus on it.
      e.preventDefault();
      focusDialog();
    };
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [accountChanged]);

  useEffect(() => {
    // Cross-tab account changes: another tab signing in/out rewrites the
    // shared auth blob while this tab still renders the old user. A hard
    // reload here would destroy in-progress wizard entry (React state only)
    // and could even interrupt a multi-request submission after the family
    // POST committed but before the visit followed. Instead: block the tab
    // with an overlay that PRESERVES the draft. It clears automatically if
    // the original account is restored in the other tab; the only way to
    // proceed under the new identity is an explicit discard-and-reload.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== AUTH_STORAGE_KEY) return;
      const now = getUser();
      if (!now) setAccountChanged('signed-out');
      else if (now.id !== user.id) setAccountChanged({ name: now.name });
      else setAccountChanged(null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user.id]);

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    // Overlapping doFlush invocations ('online' during a slow flush) must not
    // orphan a timer: always clear before assigning, or unmount cleanup can
    // miss one and a dead component flushes with a stale identity.
    const scheduleFlush = (ms: number) => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = disposed ? undefined : setTimeout(doFlush, ms);
    };
    const doFlush = async () => {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = undefined; }
      try {
        // ONE auth snapshot for the WHOLE flush. The token and the user id
        // live in the same storage blob but reading them separately (or at
        // different times) lets a cross-tab account switch produce token-B +
        // user-A: A's queued items pass the owner check and post under B's
        // identity. Snapshot both together; a mid-flush switch then 401s
        // (items stay queued) instead of misattributing.
        const auth = getAuth();
        const pinned = apiWithToken(auth?.token ?? null);
        const apiFn = (url: string, body: unknown, method?: 'POST' | 'PATCH') =>
          method === 'PATCH'
            ? pinned.patch<unknown>(url, body as Record<string, unknown>)
            : pinned.post<unknown>(url, body as Record<string, unknown>);
        const result = await flushQueue(apiFn, auth?.user.id);
        if (disposed) return;
        // A skipped result means another flush was already in flight — it
        // says nothing about queue health, so it must not clear warning
        // banners. The in-flight flush may belong to an UNMOUNTED Layout
        // whose setState is dead, so re-check shortly: THIS component must
        // be the one that surfaces the real results.
        if (result.skipped) {
          scheduleFlush(5_000);
          return;
        }
        setSyncBroken(false);
        setForeignCount(result.foreignItems);
        if (result.errors > 0) {
          console.warn(`offline sync: ${result.errors} item(s) failed transiently — retrying in 30s`);
          // Mount and 'online' are not enough: a 503 or transient fetch
          // failure while the browser STAYS online needs a scheduled retry.
          scheduleFlush(30_000);
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
      // Same-snapshot rule as the flush: adopt under whoever is signed in
      // NOW, not the mount-time closure.
      const auth = getAuth();
      if (!auth) return;
      await adoptForeignItems(auth.user.id);
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
      {accountChanged && (
        <div
          ref={overlayRef}
          tabIndex={-1}
          role="alertdialog"
          aria-modal="true"
          aria-label="Account changed in another tab"
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div className="banner" style={{ background: '#fff', color: '#1a1a1a', borderRadius: 8, padding: 20, maxWidth: 520 }}>
            <p style={{ marginTop: 0, fontWeight: 600 }}>
              {accountChanged === 'signed-out'
                ? 'This account was signed out in another tab. / Esta cuenta cerró sesión en otra pestaña.'
                : `Another tab signed in as ${accountChanged.name}. / Otra pestaña inició sesión como ${accountChanged.name}.`}
            </p>
            <p>
              Anything typed on this screen is paused, not lost. To finish this entry, sign back in as {user.name} in the other tab and this notice will clear. / Lo escrito está pausado, no perdido. Vuelva a iniciar sesión como {user.name} en la otra pestaña para continuar.
            </p>
            <button
              className="btn-ghost"
              style={{ fontSize: 13 }}
              onClick={() => window.location.reload()}
            >
              {accountChanged === 'signed-out'
                ? 'Discard this entry and go to sign-in / Descartar y salir'
                : `Discard this entry and continue as ${accountChanged.name} / Descartar y continuar`}
            </button>
          </div>
        </div>
      )}
      {!swSupported && (
        <div className="banner" style={{ margin: 0, borderRadius: 0, padding: '6px 12px', fontSize: 13 }}>
          <p style={{ margin: 0 }}>
            This device can't reopen the app while offline — keep this tab open during outages. Entries still save and sync. / Este dispositivo no puede reabrir la app sin conexión — mantenga esta pestaña abierta. Las entradas se guardan y sincronizan.
          </p>
        </div>
      )}
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
