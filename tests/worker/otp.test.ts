import { env } from 'cloudflare:workers';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { generateOtpCode, createOtp, verifyOtp, sendOtpSms } from '../../src/worker/otp';
import type { Env } from '../../src/worker/schema';

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  const db = (env as unknown as Env).DB;
  await db.prepare('DELETE FROM otp_codes').run();
});

describe('generateOtpCode', () => {
  it('returns a 6-digit string', () => {
    const code = generateOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('returns different codes on successive calls', () => {
    const codes = new Set(Array.from({ length: 10 }, () => generateOtpCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('createOtp', () => {
  it('inserts a code and returns it', async () => {
    const db = (env as unknown as Env).DB;
    const code = await createOtp(db, '4805551234');
    expect(code).toMatch(/^\d{6}$/);
    const row = await db.prepare(
      `SELECT * FROM otp_codes WHERE phone = ? AND code = ?`
    ).bind('4805551234', code).first();
    expect(row).not.toBeNull();
  });
});

describe('verifyOtp', () => {
  it('returns true for a valid unused code', async () => {
    const db = (env as unknown as Env).DB;
    const code = await createOtp(db, '4805551234');
    const result = await verifyOtp(db, '4805551234', code);
    expect(result).toBe(true);
  });

  it('marks the code as used after verification', async () => {
    const db = (env as unknown as Env).DB;
    const code = await createOtp(db, '4805551234');
    await verifyOtp(db, '4805551234', code);
    const result = await verifyOtp(db, '4805551234', code);
    expect(result).toBe(false);
  });

  it('returns false for a wrong code', async () => {
    const db = (env as unknown as Env).DB;
    await createOtp(db, '4805551234');
    const result = await verifyOtp(db, '4805551234', '000000');
    expect(result).toBe(false);
  });

  it('returns false for a code belonging to a different phone', async () => {
    const db = (env as unknown as Env).DB;
    const code = await createOtp(db, '4805551234');
    const result = await verifyOtp(db, '6025559999', code);
    expect(result).toBe(false);
  });

  it('returns false for an expired code', async () => {
    const db = (env as unknown as Env).DB;
    const id = crypto.randomUUID().replace(/-/g, '');
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    await db.prepare(
      `INSERT INTO otp_codes (id, phone, code, expires_at) VALUES (?, ?, ?, ?)`
    ).bind(id, '4805551234', '123456', pastExpiry).run();
    const result = await verifyOtp(db, '4805551234', '123456');
    expect(result).toBe(false);
  });

  it('old code is invalidated when a new code is requested', async () => {
    const db = (env as unknown as Env).DB;
    const oldCode = await createOtp(db, '4805551234');
    const newCode = await createOtp(db, '4805551234');
    // old code must no longer work
    expect(await verifyOtp(db, '4805551234', oldCode)).toBe(false);
    // new code works
    expect(await verifyOtp(db, '4805551234', newCode)).toBe(true);
  });
});

describe('sendOtpSms', () => {
  it('sends a correctly-formed request to Twilio', async () => {
    const accountSid = 'ACtest123';
    const authToken = 'authtoken456';
    const fromNumber = '0000000000';
    const toPhone = '4805551234';
    const code = '123456';

    const mock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`);
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ sid: 'SM123' }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', mock);

    await sendOtpSms(accountSid, authToken, fromNumber, toPhone, code);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('throws on non-ok Twilio response', async () => {
    const accountSid = 'ACtest123';
    const authToken = 'authtoken456';

    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })));

    await expect(
      sendOtpSms(accountSid, authToken, '0000000000', '4805551234', '123456')
    ).rejects.toThrow('Twilio 401');
  });
});
