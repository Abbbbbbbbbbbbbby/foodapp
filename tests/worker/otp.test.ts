import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { generateOtpCode, createOtp, verifyOtp } from '../../src/worker/otp';
import type { Env } from '../../src/worker/schema';

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
});
