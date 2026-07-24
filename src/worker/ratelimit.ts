// SMS rate limiting using KV with time-slot keys.
// KV has eventual consistency but that's acceptable here — we're protecting
// against accidental or casual abuse, not adversarial brute-force at scale.
//
// Per-phone limits cap a misbehaving user.
// Global limits cap total Twilio spend (SMS pumping protection).

const OTP_SEND_PER_PHONE_PER_HOUR = 5;
const OTP_SEND_GLOBAL_PER_HOUR = 30;
const OTP_SEND_GLOBAL_PER_DAY = 60;
const OTP_VERIFY_MAX = 10; // per phone per hour

function hourSlot(): number {
  return Math.floor(Date.now() / 3_600_000);
}

function daySlot(): number {
  return Math.floor(Date.now() / 86_400_000);
}

async function getCount(kv: KVNamespace, key: string): Promise<number> {
  const val = await kv.get(key);
  const n = val ? parseInt(val, 10) : 0;
  return isNaN(n) ? 0 : n;
}

async function increment(kv: KVNamespace, key: string, ttl: number, current: number): Promise<void> {
  await kv.put(key, String(current + 1), { expirationTtl: ttl });
}

export async function checkOtpSendLimit(
  kv: KVNamespace,
  phone: string
): Promise<{ allowed: boolean; remaining: number }> {
  const phoneKey = `rl:otp:send:${phone}:h${hourSlot()}`;
  const globalHourKey = `rl:otp:global:h${hourSlot()}`;
  const globalDayKey = `rl:otp:global:d${daySlot()}`;

  const [phoneCount, globalHour, globalDay] = await Promise.all([
    getCount(kv, phoneKey),
    getCount(kv, globalHourKey),
    getCount(kv, globalDayKey),
  ]);

  if (phoneCount >= OTP_SEND_PER_PHONE_PER_HOUR) return { allowed: false, remaining: 0 };
  if (globalHour >= OTP_SEND_GLOBAL_PER_HOUR) return { allowed: false, remaining: 0 };
  if (globalDay >= OTP_SEND_GLOBAL_PER_DAY) return { allowed: false, remaining: 0 };

  await Promise.all([
    increment(kv, phoneKey, 3600, phoneCount),
    increment(kv, globalHourKey, 3600, globalHour),
    increment(kv, globalDayKey, 86400, globalDay),
  ]);

  const remaining = Math.min(
    OTP_SEND_PER_PHONE_PER_HOUR - phoneCount - 1,
    OTP_SEND_GLOBAL_PER_HOUR - globalHour - 1,
    OTP_SEND_GLOBAL_PER_DAY - globalDay - 1
  );
  return { allowed: true, remaining };
}

export async function checkVerifyLimit(
  kv: KVNamespace,
  phone: string
): Promise<{ allowed: boolean }> {
  const key = `rl:verify:${phone}:h${hourSlot()}`;
  const count = await getCount(kv, key);
  if (count >= OTP_VERIFY_MAX) return { allowed: false };
  await increment(kv, key, 3600, count);
  return { allowed: true };
}
