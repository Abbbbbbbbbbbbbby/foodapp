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

describe('same-origin passthrough (preview deployments)', () => {
  it('an Origin matching the request URL origin passes even when not allowlisted', async () => {
    // Simulates a Workers Builds preview hostname POSTing to itself.
    const res = await workerExports.default.fetch('https://preview-abc.example.dev/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://preview-abc.example.dev' },
      body: JSON.stringify({ phone: '4805550302' }),
    });
    expect(res.status).not.toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://preview-abc.example.dev');
  });

  it('a cross-origin unlisted Origin on the same host pattern is still rejected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await workerExports.default.fetch('https://preview-abc.example.dev/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.dev' },
      body: JSON.stringify({ phone: '4805550303' }),
    });
    expect(res.status).toBe(403);
    warn.mockRestore();
  });
});

describe('auth body size cap (pre-auth DoS)', () => {
  it('an oversized auth POST body is rejected 413 before the handler runs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const huge = JSON.stringify({ phone: '4805550401', pad: 'x'.repeat(8000) });
    const res = await workerExports.default.fetch('http://127.0.0.1/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: huge,
    });
    expect(res.status).toBe(413);
    expect(warn).toHaveBeenCalledWith('auth body rejected', 'too large', expect.stringContaining('/api/auth/login'));
    warn.mockRestore();
  });

  it('register and verify also reject an oversized body with 413 (not just login)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const path of ['/api/auth/register', '/api/auth/verify']) {
      const res = await workerExports.default.fetch(`http://127.0.0.1${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '4805550410', pad: 'x'.repeat(8000) }),
      });
      expect(res.status, path).toBe(413);
    }
    warn.mockRestore();
  });

  it('an invalid-JSON auth body is rejected 400 AND logged (log-before-validate)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await workerExports.default.fetch('http://127.0.0.1/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    expect(res.status).toBe(400);
    expect(warn).toHaveBeenCalledWith('auth body rejected', 'invalid json', expect.stringContaining('/api/auth/login'));
    warn.mockRestore();
  });

  it('a normal-size auth body still parses', async () => {
    const res = await workerExports.default.fetch('http://127.0.0.1/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '4805550402' }),
    });
    // 404 (no account) or 200/400 — anything but 413/415 proves the body parsed.
    expect(res.status).not.toBe(413);
    expect(res.status).not.toBe(415);
  });
});
