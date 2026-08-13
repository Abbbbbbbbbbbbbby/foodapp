import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, apiWithToken } from '../../src/pwa/lib/api';
import { setAuth, getToken } from '../../src/pwa/store/auth';

const volunteer = { id: 'u1', name: 'Vol', phone: '4805550001', role: 'volunteer' as const };

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
}

// One queued submission spans several requests (family → visit → bag). If the
// token is read live per request, an account switch mid-flush splits ONE
// submission across TWO identities (reproduced: family under A, visit under
// B). apiWithToken pins the identity for the whole flush.
describe('apiWithToken — identity pinned across an account switch', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', okFetch());
    // jsdom's opaque test origin exposes no localStorage global — shim it so
    // the REAL auth store runs (the pinning behavior under test spans both).
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function authHeaderOfCall(n: number): string | undefined {
    const call = vi.mocked(fetch).mock.calls[n];
    return ((call[1]?.headers ?? {}) as Record<string, string>)['Authorization'];
  }

  it('keeps using the flush-start token after the signed-in user changes', async () => {
    setAuth('token-A', volunteer);
    const pinned = apiWithToken(getToken());
    await pinned.post('/api/families', { name: 'Fam' });

    // Account switch between the two requests of one queued submission.
    setAuth('token-B', { ...volunteer, id: 'u2' });
    await pinned.post('/api/visits', { family_id: 'f1' });

    expect(authHeaderOfCall(0)).toBe('Bearer token-A');
    expect(authHeaderOfCall(1)).toBe('Bearer token-A'); // NOT token-B
  });

  it('the unpinned api still reads the live token (foreground requests)', async () => {
    setAuth('token-A', volunteer);
    await api.post('/api/families', { name: 'Fam' });
    setAuth('token-B', { ...volunteer, id: 'u2' });
    await api.post('/api/visits', { family_id: 'f1' });

    expect(authHeaderOfCall(0)).toBe('Bearer token-A');
    expect(authHeaderOfCall(1)).toBe('Bearer token-B');
  });
});
