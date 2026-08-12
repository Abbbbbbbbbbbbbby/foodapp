import { env } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';
import { checkOtpSendLimit, checkVerifyLimit } from '../../src/worker/ratelimit';
import type { Env } from '../../src/worker/schema';

const kv = () => (env as unknown as Env).SESSIONS;

async function clearRl() {
  const list = await kv().list({ prefix: 'rl:' });
  await Promise.all(list.keys.map(k => kv().delete(k.name)));
}

describe('SMS rate limits', () => {
  beforeEach(clearRl);

  it('per-phone send cap: 5 allowed, 6th denied; other phones unaffected', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await checkOtpSendLimit(kv(), '4805550001')).allowed).toBe(true);
    }
    expect((await checkOtpSendLimit(kv(), '4805550001')).allowed).toBe(false);
    // Per-phone isolation: a different phone still passes
    expect((await checkOtpSendLimit(kv(), '4805550002')).allowed).toBe(true);
  });

  it('global hourly cap: 30 sends across rotating phones, 31st denied (SMS pumping)', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await checkOtpSendLimit(kv(), `48055597${String(i).padStart(2, '0')}`);
      expect(r.allowed).toBe(true);
    }
    // Fresh phone, but the global ceiling is reached
    expect((await checkOtpSendLimit(kv(), '4805550099')).allowed).toBe(false);
  });

  it('verify cap: 10 attempts then denied per phone', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await checkVerifyLimit(kv(), '4805550003')).allowed).toBe(true);
    }
    expect((await checkVerifyLimit(kv(), '4805550003')).allowed).toBe(false);
  });

  it('corrupt counter value fails safe to 0, not permanently open or closed', async () => {
    const hourSlot = Math.floor(Date.now() / 3_600_000);
    await kv().put(`rl:otp:send:4805550004:h${hourSlot}`, 'garbage-not-a-number');
    const r = await checkOtpSendLimit(kv(), '4805550004');
    expect(r.allowed).toBe(true); // treated as 0, then incremented to a real number
    const stored = await kv().get(`rl:otp:send:4805550004:h${hourSlot}`);
    expect(stored).toBe('1');
  });
});
