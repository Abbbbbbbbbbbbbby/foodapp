// Part B abuse hardening (issue #13): cross-origin request rejection and the
// CORS allowlist. Auth is a Bearer header (no cookies), so this is abuse
// damping — a hostile page must not be able to fire no-cors POSTs that
// trigger SMS/D1 work from visitors' browsers.
import { env, exports as workerExports } from 'cloudflare:workers';
import { describe, it, expect, vi } from 'vitest';

const ALLOWED = 'https://foodboxdata.creightoncommunityfoundation.org';

function authPost(headers: Record<string, string>) {
  return workerExports.default.fetch('http://127.0.0.1/api/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ phone: '4805550301' }),
  });
}

describe('origin gate on pre-auth POSTs', () => {
  it('an allowlisted Origin is reflected in Access-Control-Allow-Origin', async () => {
    const res = await authPost({ 'Content-Type': 'application/json', Origin: ALLOWED });
    expect(res.status).not.toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED);
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it('a disallowed Origin is rejected 403 before any handler runs, and logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await authPost({ 'Content-Type': 'application/json', Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    // No CORS headers for an unlisted origin — the page can't read this either.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(warn).toHaveBeenCalledWith('cross-origin rejected', 'https://evil.example', '/api/auth/login');
    warn.mockRestore();
  });

  it('a request with no Origin header (curl/native) passes through', async () => {
    const res = await authPost({ 'Content-Type': 'application/json' });
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(415);
  });

  it('client-events POST with a disallowed Origin is rejected 403', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await workerExports.default.fetch('http://127.0.0.1/api/client-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify([]),
    });
    expect(res.status).toBe(403);
    warn.mockRestore();
  });

  it('a text/plain auth POST is rejected 415 (form/no-cors vector), and logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await authPost({ 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
    expect(warn).toHaveBeenCalledWith('non-json auth POST rejected', 'text/plain', '/api/auth/login');
    warn.mockRestore();
  });

  it('client-events accepts text/plain (sendBeacon cannot set headers)', async () => {
    const res = await workerExports.default.fetch('http://127.0.0.1/api/client-events', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify([{
        id: crypto.randomUUID(), session_id: 's-og', device_id: 'd-og',
        level: 'info', kind: 'view_change',
      }]),
    });
    expect(res.status).toBe(200);
  });
});
