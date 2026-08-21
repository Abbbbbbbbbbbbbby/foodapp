import { describe, it, expect } from 'vitest';
import { signSession, verifySession, SESSION_TTL_SECONDS } from '../../src/admin/session';

const SECRET = 'test-admin-secret';

describe('admin session cookie', () => {
  it('round-trips an email', async () => {
    const token = await signSession('abby@creightoncommunityfoundation.org', SECRET);
    expect(await verifySession(token, SECRET)).toBe('abby@creightoncommunityfoundation.org');
  });

  it('rejects a tampered payload', async () => {
    const token = await signSession('abby@creightoncommunityfoundation.org', SECRET);
    const [payload, sig] = token.split('.');
    const forged = btoa(JSON.stringify({ email: 'evil@evil.example', exp: 9999999999 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(payload).toBeTruthy();
  });

  it('rejects the wrong secret', async () => {
    const token = await signSession('abby@creightoncommunityfoundation.org', SECRET);
    expect(await verifySession(token, 'some-other-secret')).toBeNull();
  });

  it('rejects an expired token (now injection past the 8h TTL)', async () => {
    const t0 = Date.now();
    const token = await signSession('abby@creightoncommunityfoundation.org', SECRET, t0);
    const past = t0 + (SESSION_TTL_SECONDS + 1) * 1000;
    expect(await verifySession(token, SECRET, past)).toBeNull();
    expect(await verifySession(token, SECRET, t0 + 1000)).not.toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifySession('no-dot-here', SECRET)).toBeNull();
    expect(await verifySession('not-json.also-not-sig', SECRET)).toBeNull();
    expect(await verifySession('', SECRET)).toBeNull();
  });
});
