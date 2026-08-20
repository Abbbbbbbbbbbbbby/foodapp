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

// Client-supplied device_id, so the per-device cap only dampens an honest
// client's bug (a crash loop flushing every 5s tops out around 720/hr) —
// it is not an abuse boundary. The global cap is the real damping on a
// rotating-device_id sender; both are approximate (eventual-consistency KV).
const CLIENT_EVENTS_PER_DEVICE_PER_HOUR = 800;
const CLIENT_EVENTS_GLOBAL_PER_HOUR = 5000;

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

async function increment(kv: KVNamespace, key: string, ttl: number, current: number, by = 1): Promise<void> {
  await kv.put(key, String(current + by), { expirationTtl: ttl });
}

export async function checkOtpSendLimit(
  kv: KVNamespace,
  phone: string,
  // Test harnesses (e2e against a persistent local KV) exhaust the GLOBAL
  // caps by sheer run count; the per-phone cap stays enforced everywhere.
  opts?: { skipGlobal?: boolean }
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
  if (!opts?.skipGlobal && globalHour >= OTP_SEND_GLOBAL_PER_HOUR) return { allowed: false, remaining: 0 };
  if (!opts?.skipGlobal && globalDay >= OTP_SEND_GLOBAL_PER_DAY) return { allowed: false, remaining: 0 };

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

export async function checkClientEventLimit(
  kv: KVNamespace,
  deviceId: string,
  // Counts EVENTS, not requests — a single POST can carry up to 50 events
  // (clientEvents.ts's MAX_EVENTS_PER_BATCH), so counting requests let the
  // advertised per-hour caps be exceeded by up to 50x.
  eventCount: number,
  opts?: { skipGlobal?: boolean }
): Promise<{ allowed: boolean }> {
  // Fixed 'device:' segment before the interpolated deviceId: a
  // client-supplied device_id of "global" must never be able to produce
  // the same key as globalKey below (it can't — no deviceId string can
  // retroactively remove the "device:" prefix already written ahead of
  // it), or that device's traffic collapses into the shared global
  // counter and can cheaply exhaust it for every other client.
  const deviceKey = `rl:cev:device:${deviceId}:h${hourSlot()}`;
  const globalKey = `rl:cev:global:h${hourSlot()}`;

  const [deviceCount, globalCount] = await Promise.all([
    getCount(kv, deviceKey),
    getCount(kv, globalKey),
  ]);

  if (deviceCount + eventCount > CLIENT_EVENTS_PER_DEVICE_PER_HOUR) return { allowed: false };
  if (!opts?.skipGlobal && globalCount + eventCount > CLIENT_EVENTS_GLOBAL_PER_HOUR) return { allowed: false };

  await Promise.all([
    increment(kv, deviceKey, 3600, deviceCount, eventCount),
    increment(kv, globalKey, 3600, globalCount, eventCount),
  ]);
  return { allowed: true };
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
