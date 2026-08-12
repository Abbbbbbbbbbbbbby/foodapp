import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/pwa/store/auth', () => ({
  getToken: vi.fn(() => 'tok-123'),
}));

import { api, ApiError } from '../../src/pwa/lib/api';
import { getToken } from '../../src/pwa/store/auth';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('attaches the bearer token and parses JSON', async () => {
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
      return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
    });
    vi.stubGlobal('fetch', mock);
    const out = await api.get<{ ok: number }>('/api/x');
    expect(out.ok).toBe(1);
  });

  it('omits the auth header when logged out', async () => {
    vi.mocked(getToken).mockReturnValueOnce(null);
    const mock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', mock);
    await api.get('/api/x');
    expect(mock).toHaveBeenCalled();
  });

  it('throws ApiError with the server message on non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: 'hispanic must be valid' }), { status: 400 })));
    await expect(api.post('/api/x', {})).rejects.toMatchObject({ status: 400, message: 'hispanic must be valid' });
  });

  it('falls back to statusText when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' })));
    const err = await api.post('/api/x', {}).catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
  });
});
