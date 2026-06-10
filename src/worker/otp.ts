const OTP_TTL_SECONDS = 600; // 10 minutes
const OTP_DIGITS = 6;

export function generateOtpCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(n % 1_000_000).padStart(OTP_DIGITS, '0');
}

export async function createOtp(db: D1Database, phone: string): Promise<string> {
  const code = generateOtpCode();
  const id = crypto.randomUUID().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString();
  // Invalidate any prior active codes so only the newest is usable
  await db.prepare(
    `UPDATE otp_codes SET used = 1 WHERE phone = ? AND used = 0`
  ).bind(phone).run();
  await db.prepare(
    `INSERT INTO otp_codes (id, phone, code, expires_at) VALUES (?, ?, ?, ?)`
  ).bind(id, phone, code, expiresAt).run();
  return code;
}

export async function verifyOtp(
  db: D1Database,
  phone: string,
  code: string
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT id FROM otp_codes
    WHERE phone = ? AND code = ? AND used = 0
      AND datetime(expires_at) > datetime('now')
    ORDER BY created_at DESC LIMIT 1
  `).bind(phone, code).first<{ id: string }>();
  if (!row) return false;
  await db.prepare(`UPDATE otp_codes SET used = 1 WHERE id = ?`).bind(row.id).run();
  return true;
}

export async function sendOtpSms(
  accountSid: string,
  authToken: string,
  fromNumber: string,
  toPhone: string,
  code: string
): Promise<void> {
  const body = `Your Creighton Community Foundation verification code is: ${code}. Valid for 10 minutes.`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: `+1${toPhone}`,
      From: fromNumber,
      Body: body,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio ${res.status}: ${text}`);
  }
}
