# Food Line App — Plan 2: Auth + Question Settings

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SMS OTP authentication, JWT sessions, role-based middleware, and an admin-configurable question settings table seeded with all 18 registration questions.

**Architecture:** Four new source modules (otp.ts, auth.ts, middleware.ts, routes/auth.ts) plug into the existing Worker entry point. Question settings live in a new D1 table; admins will manage them in Plan 4 — for now the table is seeded and readable. Twilio sends OTP codes; JWT (HS256 via Web Crypto API — no external library) stores session identity; Cloudflare KV backs server-side session invalidation so tokens can be revoked before expiry.

**Tech Stack:** Cloudflare Workers Web Crypto API (JWT HS256), Cloudflare D1 (OTP codes, question_settings, users), Cloudflare KV (session store), Twilio REST API (SMS), Vitest + @cloudflare/vitest-pool-workers

---

## File Map

```
foodapp/
├── migrations/
│   └── 0002_question_settings.sql    create — question_settings table + 18 seeded rows
├── src/worker/
│   ├── schema.ts                     modify — add QuestionSetting type
│   ├── otp.ts                        create — OTP generation, DB storage, verification, Twilio send
│   ├── auth.ts                       create — JWT sign/verify, KV session CRUD, session builder
│   ├── middleware.ts                 create — getAuthContext, requireRole
│   ├── index.ts                      modify — wire in /api/auth/* routes
│   └── routes/
│       └── auth.ts                   create — POST /login, /verify, /register, /logout; GET /me
├── tests/worker/
│   ├── setup.ts                      modify — add test bindings (JWT_SECRET, ENVIRONMENT=test)
│   ├── otp.test.ts                   create — OTP unit tests
│   ├── auth.test.ts                  create — JWT + session unit tests
│   ├── middleware.test.ts            create — middleware unit tests
│   └── routes/
│       └── auth.test.ts              create — auth route integration tests
└── vitest.config.ts                  modify — add miniflare bindings for test env vars
```

---

## Prerequisites (manual — do before Task 1)

Create `/Users/aboles/code/foodapp/.dev.vars` (already in `.gitignore`):

```
JWT_SECRET=replace-with-output-of-command-below
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
ENVIRONMENT=development
```

Generate a secure JWT_SECRET:
```bash
export PATH="/opt/homebrew/bin:$PATH" && node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Twilio credentials are in your Twilio console at console.twilio.com. The phone number must be a Twilio number with SMS capability.

---

## Task 1: question_settings migration

**Files:**
- Create: `migrations/0002_question_settings.sql`
- Modify: `src/worker/schema.ts` — add `QuestionSetting` type

- [ ] **Step 1: Write the migration**

Create `/Users/aboles/code/foodapp/migrations/0002_question_settings.sql`:

```sql
CREATE TABLE IF NOT EXISTS question_settings (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  field_name TEXT NOT NULL UNIQUE,
  label_en TEXT NOT NULL,
  label_es TEXT NOT NULL,
  hint_en TEXT,
  hint_es TEXT,
  input_type TEXT NOT NULL CHECK (input_type IN (
    'text', 'phone', 'number', 'select', 'yesno', 'yesno_declined', 'income'
  )),
  options_en TEXT,
  options_es TEXT,
  visible INTEGER NOT NULL DEFAULT 1,
  required INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_question_settings_order
  ON question_settings(display_order);

INSERT OR IGNORE INTO question_settings
  (id, field_name, label_en, label_es, hint_en, hint_es,
   input_type, options_en, options_es, visible, required, display_order)
VALUES
  ('qs01', 'language',
   'What language do you prefer?',
   '¿Qué idioma prefiere?',
   NULL, NULL,
   'select',
   '["English","Spanish","Other"]',
   '["Inglés","Español","Otro"]',
   1, 0, 10),

  ('qs02', 'name',
   'Family last name',
   'Apellido familiar',
   'Enter the last name used to identify this household.',
   'Ingrese el apellido que se usa para identificar a este hogar.',
   'text',
   NULL, NULL,
   1, 1, 20),

  ('qs03', 'phone',
   'Phone number',
   'Número de teléfono',
   'Enter digits only. Leave blank if no phone.',
   'Solo dígitos. Deje en blanco si no tiene teléfono.',
   'phone',
   NULL, NULL,
   1, 0, 30),

  ('qs04', 'address',
   'Home address',
   'Dirección de casa',
   NULL, NULL,
   'text',
   NULL, NULL,
   1, 0, 40),

  ('qs05', 'zip_code',
   'ZIP code',
   'Código postal',
   NULL, NULL,
   'text',
   NULL, NULL,
   1, 0, 50),

  ('qs06', 'num_people',
   'How many people live in your household?',
   '¿Cuántas personas viven en su hogar?',
   'Include everyone who lives there, including yourself.',
   'Incluya a todos los que viven allí, incluyéndose usted.',
   'number',
   NULL, NULL,
   1, 0, 60),

  ('qs07', 'num_children_under_18',
   'How many children under 18 live in your household?',
   '¿Cuántos niños menores de 18 años viven en su hogar?',
   NULL, NULL,
   'number',
   NULL, NULL,
   1, 0, 70),

  ('qs08', 'num_children_under_5',
   'How many children under 5 live in your household?',
   '¿Cuántos niños menores de 5 años viven en su hogar?',
   NULL, NULL,
   'number',
   NULL, NULL,
   1, 0, 80),

  ('qs09', 'num_with_diabetes',
   'How many household members have diabetes?',
   '¿Cuántos miembros del hogar tienen diabetes?',
   NULL, NULL,
   'number',
   NULL, NULL,
   1, 0, 90),

  ('qs10', 'ethnicity',
   'What is your race or ethnicity?',
   '¿Cuál es su raza o etnia?',
   'Select all that apply.',
   'Seleccione todas las que correspondan.',
   'select',
   '["American Indian or Alaska Native","Asian","Black or African American","Native Hawaiian or Other Pacific Islander","White","Multiracial","Other","Prefer not to say"]',
   '["Indígena americano o nativo de Alaska","Asiático","Negro o afroamericano","Nativo de Hawái u otro isleño del Pacífico","Blanco","Multirracial","Otro","Prefiero no decir"]',
   1, 0, 100),

  ('qs11', 'hispanic',
   'Do you identify as Hispanic or Latino?',
   '¿Se identifica como hispano o latino?',
   NULL, NULL,
   'yesno_declined',
   NULL, NULL,
   1, 0, 110),

  ('qs12', 'health_insurance',
   'Does anyone in your household have health insurance?',
   '¿Alguien en su hogar tiene seguro médico?',
   NULL, NULL,
   'yesno_declined',
   NULL, NULL,
   1, 0, 120),

  ('qs13', 'snap_benefits',
   'Does your household receive SNAP benefits (food stamps)?',
   '¿Su hogar recibe beneficios SNAP (cupones de alimentos)?',
   NULL, NULL,
   'yesno_declined',
   NULL, NULL,
   1, 0, 130),

  ('qs14', 'ami_bracket',
   'What is your household income?',
   '¿Cuál es el ingreso de su hogar?',
   'We use this to understand community needs. Your answer stays private.',
   'Usamos esto para entender las necesidades de la comunidad. Su respuesta es privada.',
   'income',
   '["weekly","biweekly","monthly","yearly"]',
   '["semanal","quincenal","mensual","anual"]',
   1, 0, 140),

  ('qs15', 'receives_texts',
   'Can we send you text messages?',
   '¿Podemos enviarle mensajes de texto?',
   'We only send messages about picking up food.',
   'Solo enviamos mensajes sobre la recogida de alimentos.',
   'yesno',
   NULL, NULL,
   1, 0, 150),

  ('qs16', 'want_text_updates',
   'Would you like reminders about upcoming food distribution events?',
   '¿Le gustaría recordatorios sobre próximos eventos de distribución de alimentos?',
   NULL, NULL,
   'yesno',
   NULL, NULL,
   1, 0, 160),

  ('qs17', 'id_confirmed',
   'ID confirmed',
   'ID confirmado',
   NULL, NULL,
   'yesno',
   NULL, NULL,
   1, 0, 170),

  ('qs18', 'bag_received',
   'Bag received',
   'Bolsa recibida',
   NULL, NULL,
   'yesno',
   NULL, NULL,
   1, 0, 180);
```

- [ ] **Step 2: Apply migration locally**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm run migrate:local
```

Expected: `Applied 1 migration` or `0002_question_settings.sql ✅`

- [ ] **Step 3: Verify rows exist**

```bash
export PATH="/opt/homebrew/bin:$PATH" && wrangler d1 execute foodapp --local --command="SELECT field_name, label_en, input_type FROM question_settings ORDER BY display_order;"
```

Expected: 18 rows, ordered from `language` to `bag_received`.

- [ ] **Step 4: Add QuestionSetting type to schema.ts**

Open `/Users/aboles/code/foodapp/src/worker/schema.ts` and append at the end:

```typescript
export type QuestionInputType =
  | 'text' | 'phone' | 'number' | 'select'
  | 'yesno' | 'yesno_declined' | 'income';

export interface QuestionSetting {
  id: string;
  field_name: string;
  label_en: string;
  label_es: string;
  hint_en: string | null;
  hint_es: string | null;
  input_type: QuestionInputType;
  options_en: string | null;  // JSON array string
  options_es: string | null;  // JSON array string
  visible: boolean;
  required: boolean;
  display_order: number;
  updated_at: string;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add migrations/0002_question_settings.sql src/worker/schema.ts
git commit -m "feat: question_settings migration with 18 seeded questions"
```

---

## Task 2: OTP utilities

**Files:**
- Create: `src/worker/otp.ts`
- Create: `tests/worker/otp.test.ts`
- Modify: `vitest.config.ts` — add miniflare bindings for test env vars
- Modify: `tests/worker/setup.ts` — apply second migration in test setup

- [ ] **Step 1: Update vitest.config.ts to inject test env vars**

Open `/Users/aboles/code/foodapp/vitest.config.ts` and update the miniflare section:

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          kvNamespaces: ['SESSIONS'],
          bindings: {
            JWT_SECRET: 'test-secret-do-not-use-in-production-aabbccdd',
            TWILIO_ACCOUNT_SID: 'test',
            TWILIO_AUTH_TOKEN: 'test',
            TWILIO_PHONE_NUMBER: '0000000000',
            ENVIRONMENT: 'test',
          },
        },
      },
    },
    setupFiles: ['./tests/worker/setup.ts'],
    include: ['tests/worker/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Update tests/worker/setup.ts to apply both migrations**

The setup currently applies `0001_initial.sql`. It must also apply `0002_question_settings.sql`. Replace the file content at `/Users/aboles/code/foodapp/tests/worker/setup.ts`:

```typescript
import { env } from 'cloudflare:test';
import { beforeAll } from 'vitest';
import type { Env } from '../../src/worker/schema';

// @ts-expect-error - Vite ?raw import
import schema1 from '../../migrations/0001_initial.sql?raw';
// @ts-expect-error - Vite ?raw import
import schema2 from '../../migrations/0002_question_settings.sql?raw';

function applySchema(sql: string): string[] {
  return (sql as string)
    .split(';')
    .map(s => s.replace(/--[^\n]*/g, '').trim())
    .filter(s => s.length > 0);
}

beforeAll(async () => {
  const db = (env as unknown as Env).DB;
  for (const stmt of [...applySchema(schema1), ...applySchema(schema2)]) {
    await db.prepare(stmt).run();
  }
});
```

- [ ] **Step 3: Write failing OTP tests**

Create `/Users/aboles/code/foodapp/tests/worker/otp.test.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests — expect fail**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1 | grep -E "(FAIL|PASS|Cannot find)"
```

Expected: FAIL — `Cannot find module '../../src/worker/otp'`

- [ ] **Step 5: Write otp.ts**

Create `/Users/aboles/code/foodapp/src/worker/otp.ts`:

```typescript
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
      AND expires_at > datetime('now')
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
```

- [ ] **Step 6: Run tests — expect pass**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1
```

Expected: all tests in `otp.test.ts` PASS.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts tests/worker/setup.ts src/worker/otp.ts tests/worker/otp.test.ts migrations/0002_question_settings.sql
git commit -m "feat: OTP utilities and question_settings migration"
```

---

## Task 3: JWT + session utilities

**Files:**
- Create: `src/worker/auth.ts`
- Create: `tests/worker/auth.test.ts`

- [ ] **Step 1: Write failing auth tests**

Create `/Users/aboles/code/foodapp/tests/worker/auth.test.ts`:

```typescript
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  signJwt,
  verifyJwt,
  buildSession,
  createSession,
  getSession,
  destroySession,
} from '../../src/worker/auth';
import type { Env, UserRole } from '../../src/worker/schema';

const SECRET = 'test-secret-do-not-use-in-production-aabbccdd';

describe('signJwt + verifyJwt', () => {
  it('round-trips a valid payload', async () => {
    const payload = {
      userId: 'abc123',
      phone: '4805551234',
      role: 'volunteer' as UserRole,
      sessionId: 'sess1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signJwt(payload, SECRET);
    expect(token.split('.').length).toBe(3);
    const decoded = await verifyJwt(token, SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe('abc123');
    expect(decoded!.role).toBe('volunteer');
  });

  it('returns null for a tampered token', async () => {
    const payload = {
      userId: 'abc123',
      phone: '4805551234',
      role: 'admin' as UserRole,
      sessionId: 'sess1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signJwt(payload, SECRET);
    const parts = token.split('.');
    // Flip the last char of the signature
    const tampered = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -1)}X`;
    const result = await verifyJwt(tampered, SECRET);
    expect(result).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const payload = {
      userId: 'abc123',
      phone: '4805551234',
      role: 'staff' as UserRole,
      sessionId: 'sess1',
      exp: Math.floor(Date.now() / 1000) - 1,
    };
    const token = await signJwt(payload, SECRET);
    const result = await verifyJwt(token, SECRET);
    expect(result).toBeNull();
  });

  it('returns null for a wrong secret', async () => {
    const payload = {
      userId: 'abc123',
      phone: '4805551234',
      role: 'volunteer' as UserRole,
      sessionId: 'sess1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const token = await signJwt(payload, SECRET);
    const result = await verifyJwt(token, 'wrong-secret');
    expect(result).toBeNull();
  });
});

describe('session KV', () => {
  const kv = () => (env as unknown as Env).SESSIONS;

  it('creates and retrieves a session', async () => {
    const payload = {
      userId: 'u1',
      phone: '4805551234',
      role: 'volunteer' as UserRole,
      sessionId: 'sess-kv-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    await createSession(kv(), payload);
    const result = await getSession(kv(), 'sess-kv-1');
    expect(result).not.toBeNull();
    expect(result!.userId).toBe('u1');
  });

  it('returns null after session is destroyed', async () => {
    const payload = {
      userId: 'u2',
      phone: '4805551234',
      role: 'volunteer' as UserRole,
      sessionId: 'sess-kv-2',
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    await createSession(kv(), payload);
    await destroySession(kv(), 'sess-kv-2');
    const result = await getSession(kv(), 'sess-kv-2');
    expect(result).toBeNull();
  });
});

describe('buildSession', () => {
  it('produces a token and payload with a sessionId', async () => {
    const { token, payload } = await buildSession('u1', '4805551234', 'admin', SECRET);
    expect(token.split('.').length).toBe(3);
    expect(payload.sessionId).toBeTruthy();
    expect(payload.role).toBe('admin');
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1 | grep -E "(FAIL|Cannot find)"
```

Expected: FAIL — `Cannot find module '../../src/worker/auth'`

- [ ] **Step 3: Write auth.ts**

Create `/Users/aboles/code/foodapp/src/worker/auth.ts`:

```typescript
import type { UserRole } from './schema';

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' };
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

export interface SessionPayload {
  userId: string;
  phone: string;
  role: UserRole;
  sessionId: string;
  exp: number;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALGORITHM,
    false,
    ['sign', 'verify']
  );
}

function toBase64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(str: string): string {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
}

export async function signJwt(
  payload: SessionPayload,
  secret: string
): Promise<string> {
  const enc = new TextEncoder();
  const header = toBase64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = toBase64url(enc.encode(JSON.stringify(payload)));
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign(ALGORITHM, key, enc.encode(`${header}.${body}`));
  return `${header}.${body}.${toBase64url(sig)}`;
}

export async function verifyJwt(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sigB64] = parts;
  try {
    const key = await importKey(secret);
    const sigBytes = Uint8Array.from(fromBase64url(sigB64), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      ALGORITHM,
      key,
      sigBytes,
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload: SessionPayload = JSON.parse(fromBase64url(body));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(
  kv: KVNamespace,
  payload: SessionPayload
): Promise<void> {
  await kv.put(`session:${payload.sessionId}`, JSON.stringify(payload), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

export async function getSession(
  kv: KVNamespace,
  sessionId: string
): Promise<SessionPayload | null> {
  const raw = await kv.get(`session:${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionPayload;
}

export async function destroySession(
  kv: KVNamespace,
  sessionId: string
): Promise<void> {
  await kv.delete(`session:${sessionId}`);
}

export async function buildSession(
  userId: string,
  phone: string,
  role: UserRole,
  secret: string
): Promise<{ token: string; payload: SessionPayload }> {
  const sessionId = crypto.randomUUID().replace(/-/g, '');
  const payload: SessionPayload = {
    userId,
    phone,
    role,
    sessionId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const token = await signJwt(payload, secret);
  return { token, payload };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1
```

Expected: all tests in `otp.test.ts` and `auth.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/auth.ts tests/worker/auth.test.ts
git commit -m "feat: JWT sign/verify and KV session utilities"
```

---

## Task 4: Auth middleware

**Files:**
- Create: `src/worker/middleware.ts`
- Create: `tests/worker/middleware.test.ts`

- [ ] **Step 1: Write failing middleware tests**

Create `/Users/aboles/code/foodapp/tests/worker/middleware.test.ts`:

```typescript
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { getAuthContext, requireRole } from '../../src/worker/middleware';
import { buildSession, createSession } from '../../src/worker/auth';
import type { Env } from '../../src/worker/schema';

async function makeAuthHeader(
  userId: string,
  role: 'admin' | 'staff' | 'volunteer'
): Promise<string> {
  const e = env as unknown as Env;
  const { token, payload } = await buildSession(userId, '4805551234', role, e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  return `Bearer ${token}`;
}

describe('getAuthContext', () => {
  it('returns context for a valid token', async () => {
    const e = env as unknown as Env;
    const authHeader = await makeAuthHeader('user-1', 'volunteer');
    const req = new Request('https://example.com', {
      headers: { Authorization: authHeader },
    });
    const ctx = await getAuthContext(req, e);
    expect(ctx).not.toBeNull();
    expect(ctx!.userId).toBe('user-1');
    expect(ctx!.role).toBe('volunteer');
  });

  it('returns null when Authorization header is missing', async () => {
    const e = env as unknown as Env;
    const req = new Request('https://example.com');
    const ctx = await getAuthContext(req, e);
    expect(ctx).toBeNull();
  });

  it('returns null for a malformed token', async () => {
    const e = env as unknown as Env;
    const req = new Request('https://example.com', {
      headers: { Authorization: 'Bearer not.a.jwt' },
    });
    const ctx = await getAuthContext(req, e);
    expect(ctx).toBeNull();
  });

  it('returns null when session has been destroyed', async () => {
    const e = env as unknown as Env;
    const { token, payload } = await buildSession('user-2', '4805551234', 'staff', e.JWT_SECRET);
    await createSession(e.SESSIONS, payload);
    await e.SESSIONS.delete(`session:${payload.sessionId}`);
    const req = new Request('https://example.com', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ctx = await getAuthContext(req, e);
    expect(ctx).toBeNull();
  });
});

describe('requireRole', () => {
  it('returns AuthContext when role matches', async () => {
    const e = env as unknown as Env;
    const authHeader = await makeAuthHeader('admin-1', 'admin');
    const req = new Request('https://example.com', {
      headers: { Authorization: authHeader },
    });
    const result = await requireRole('admin')(req, e);
    expect(result instanceof Response).toBe(false);
    expect((result as { role: string }).role).toBe('admin');
  });

  it('returns 401 when no token provided', async () => {
    const e = env as unknown as Env;
    const req = new Request('https://example.com');
    const result = await requireRole('admin')(req, e);
    expect(result instanceof Response).toBe(true);
    expect((result as Response).status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    const e = env as unknown as Env;
    const authHeader = await makeAuthHeader('vol-1', 'volunteer');
    const req = new Request('https://example.com', {
      headers: { Authorization: authHeader },
    });
    const result = await requireRole('admin', 'staff')(req, e);
    expect(result instanceof Response).toBe(true);
    expect((result as Response).status).toBe(403);
  });

  it('accepts multiple allowed roles', async () => {
    const e = env as unknown as Env;
    const authHeader = await makeAuthHeader('staff-1', 'staff');
    const req = new Request('https://example.com', {
      headers: { Authorization: authHeader },
    });
    const result = await requireRole('admin', 'staff')(req, e);
    expect(result instanceof Response).toBe(false);
    expect((result as { role: string }).role).toBe('staff');
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1 | grep -E "(FAIL|Cannot find)"
```

Expected: FAIL — `Cannot find module '../../src/worker/middleware'`

- [ ] **Step 3: Write middleware.ts**

Create `/Users/aboles/code/foodapp/src/worker/middleware.ts`:

```typescript
import type { Env, UserRole } from './schema';
import { verifyJwt, getSession } from './auth';
import type { SessionPayload } from './auth';

export type AuthContext = Pick<SessionPayload, 'userId' | 'phone' | 'role' | 'sessionId'>;

export async function getAuthContext(
  request: Request,
  env: Env
): Promise<AuthContext | null> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;
  const session = await getSession(env.SESSIONS, payload.sessionId);
  if (!session) return null;
  return {
    userId: session.userId,
    phone: session.phone,
    role: session.role,
    sessionId: session.sessionId,
  };
}

export function requireRole(...roles: UserRole[]) {
  return async (
    request: Request,
    env: Env
  ): Promise<AuthContext | Response> => {
    const ctx = await getAuthContext(request, env);
    if (!ctx) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!roles.includes(ctx.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    return ctx;
  };
}
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1
```

Expected: all tests in `otp.test.ts`, `auth.test.ts`, and `middleware.test.ts` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/middleware.ts tests/worker/middleware.test.ts
git commit -m "feat: auth middleware with role checking"
```

---

## Task 5: Auth API routes

**Files:**
- Create: `src/worker/routes/auth.ts`
- Create: `tests/worker/routes/auth.test.ts`
- Modify: `src/worker/index.ts` — add route dispatch for `/api/auth/*`

The auth routes implement four flows:

| Endpoint | Who calls it | What it does |
|---|---|---|
| `POST /api/auth/login` | Returning volunteer/staff/admin | Looks up user by phone, sends OTP |
| `POST /api/auth/register` | New volunteer only | Creates account, sends OTP |
| `POST /api/auth/verify` | Anyone after requesting an OTP | Verifies code, returns JWT |
| `DELETE /api/auth/logout` | Authenticated user | Destroys KV session |
| `GET /api/auth/me` | Authenticated user | Returns current user info |

- [ ] **Step 1: Write failing route tests**

Create `/Users/aboles/code/foodapp/tests/worker/routes/auth.test.ts`:

```typescript
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { createOtp } from '../../../src/worker/otp';
import { buildSession, createSession } from '../../../src/worker/auth';
import type { Env } from '../../../src/worker/schema';

beforeEach(async () => {
  const db = (env as unknown as Env).DB;
  await db.prepare('DELETE FROM otp_codes').run();
  await db.prepare('DELETE FROM users').run();
});

async function seedUser(phone: string, role: 'admin' | 'staff' | 'volunteer' = 'volunteer') {
  const db = (env as unknown as Env).DB;
  const id = crypto.randomUUID().replace(/-/g, '');
  await db.prepare(
    `INSERT INTO users (id, name, phone, role) VALUES (?, ?, ?, ?)`
  ).bind(id, 'Test User', phone, role).run();
  return id;
}

async function makeAuthToken(userId: string, role: 'admin' | 'staff' | 'volunteer') {
  const e = env as unknown as Env;
  const { token, payload } = await buildSession(userId, '4805551234', role, e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  return token;
}

describe('POST /api/auth/login', () => {
  it('returns 200 when user exists', async () => {
    await seedUser('4805551234');
    const res = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '4805551234' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { message: string };
    expect(body.message).toBe('Code sent');
  });

  it('returns 404 when user does not exist', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9999999999' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a missing phone', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/register', () => {
  it('creates a volunteer account and returns 200', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rosa Mendez', phone: '4805551234' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { message: string };
    expect(body.message).toBe('Code sent');
    const db = (env as unknown as Env).DB;
    const user = await db.prepare(
      `SELECT role FROM users WHERE phone = ?`
    ).bind('4805551234').first<{ role: string }>();
    expect(user?.role).toBe('volunteer');
  });

  it('returns 409 when phone already registered', async () => {
    await seedUser('4805551234');
    const res = await SELF.fetch('https://example.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rosa Mendez', phone: '4805551234' }),
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 for missing name', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '4805551234' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/verify', () => {
  it('returns a JWT token on valid OTP', async () => {
    const userId = await seedUser('4805551234');
    const db = (env as unknown as Env).DB;
    const code = await createOtp(db, '4805551234');
    const res = await SELF.fetch('https://example.com/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '4805551234', code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; user: { id: string; role: string } };
    expect(body.token).toBeTruthy();
    expect(body.user.id).toBe(userId);
    expect(body.user.role).toBe('volunteer');
  });

  it('returns 401 for an invalid code', async () => {
    await seedUser('4805551234');
    await createOtp((env as unknown as Env).DB, '4805551234');
    const res = await SELF.fetch('https://example.com/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '4805551234', code: '000000' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/auth/logout', () => {
  it('destroys the session and returns 200', async () => {
    const userId = await seedUser('4805551234');
    const token = await makeAuthToken(userId, 'volunteer');
    const res = await SELF.fetch('https://example.com/api/auth/logout', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/logout', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns user info for authenticated request', async () => {
    const userId = await seedUser('4805551234', 'staff');
    const token = await makeAuthToken(userId, 'staff');
    const res = await SELF.fetch('https://example.com/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; role: string };
    expect(body.id).toBe(userId);
    expect(body.role).toBe('staff');
  });

  it('returns 401 when not authenticated', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/me');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1 | tail -20
```

Expected: FAIL — route tests fail (routes not yet wired in index.ts returns 404 for all auth paths).

- [ ] **Step 3: Write routes/auth.ts**

Create `/Users/aboles/code/foodapp/src/worker/routes/auth.ts`:

```typescript
import type { Env } from '../schema';
import { createOtp, sendOtpSms } from '../otp';
import { buildSession, createSession, destroySession } from '../auth';
import { getAuthContext } from '../middleware';
import { normalizePhone } from '../db';

export async function handleAuthRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/auth/login' && request.method === 'POST') {
    return handleLogin(request, env);
  }
  if (pathname === '/api/auth/register' && request.method === 'POST') {
    return handleRegister(request, env);
  }
  if (pathname === '/api/auth/verify' && request.method === 'POST') {
    return handleVerify(request, env);
  }
  if (pathname === '/api/auth/logout' && request.method === 'DELETE') {
    return handleLogout(request, env);
  }
  if (pathname === '/api/auth/me' && request.method === 'GET') {
    return handleMe(request, env);
  }
  return null;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ phone?: string }>();
  const phone = normalizePhone(body.phone ?? null);
  if (!phone) {
    return Response.json({ error: 'phone is required' }, { status: 400 });
  }
  const user = await env.DB.prepare(
    `SELECT id FROM users WHERE phone = ? AND active = 1`
  ).bind(phone).first<{ id: string }>();
  if (!user) {
    return Response.json({ error: 'No account found for this phone number' }, { status: 404 });
  }
  const code = await createOtp(env.DB, phone);
  if (env.ENVIRONMENT !== 'test') {
    await sendOtpSms(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER, phone, code);
  }
  return Response.json({ message: 'Code sent' });
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ name?: string; phone?: string }>();
  const name = body.name?.trim();
  const phone = normalizePhone(body.phone ?? null);
  if (!name) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  if (!phone) {
    return Response.json({ error: 'phone is required' }, { status: 400 });
  }
  const existing = await env.DB.prepare(
    `SELECT id FROM users WHERE phone = ?`
  ).bind(phone).first();
  if (existing) {
    return Response.json({ error: 'Phone already registered. Please log in.' }, { status: 409 });
  }
  const id = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    `INSERT INTO users (id, name, phone, role, active, self_registered) VALUES (?, ?, ?, 'volunteer', 1, 1)`
  ).bind(id, name, phone).run();
  const code = await createOtp(env.DB, phone);
  if (env.ENVIRONMENT !== 'test') {
    await sendOtpSms(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_PHONE_NUMBER, phone, code);
  }
  return Response.json({ message: 'Code sent' });
}

async function handleVerify(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ phone?: string; code?: string }>();
  const phone = normalizePhone(body.phone ?? null);
  const code = body.code?.trim();
  if (!phone || !code) {
    return Response.json({ error: 'phone and code are required' }, { status: 400 });
  }
  const { verifyOtp } = await import('../otp');
  const valid = await verifyOtp(env.DB, phone, code);
  if (!valid) {
    return Response.json({ error: 'Invalid or expired code' }, { status: 401 });
  }
  const user = await env.DB.prepare(
    `SELECT id, name, phone, role FROM users WHERE phone = ? AND active = 1`
  ).bind(phone).first<{ id: string; name: string; phone: string; role: string }>();
  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }
  const { token, payload } = await buildSession(
    user.id, user.phone, user.role as 'admin' | 'staff' | 'volunteer', env.JWT_SECRET
  );
  await createSession(env.SESSIONS, payload);
  return Response.json({ token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role } });
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await destroySession(env.SESSIONS, ctx.sessionId);
  return Response.json({ message: 'Logged out' });
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const user = await env.DB.prepare(
    `SELECT id, name, phone, role FROM users WHERE id = ?`
  ).bind(ctx.userId).first<{ id: string; name: string; phone: string; role: string }>();
  if (!user) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }
  return Response.json(user);
}
```

- [ ] **Step 4: Wire auth routes into index.ts**

Replace `/Users/aboles/code/foodapp/src/worker/index.ts` with:

```typescript
import type { Env } from './schema';
import { handleAuthRoutes } from './routes/auth';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return cors(Response.json({ ok: true, env: env.ENVIRONMENT }));
      }

      const authResponse = await handleAuthRoutes(request, env, url.pathname);
      if (authResponse) return cors(authResponse);

      return cors(Response.json({ error: 'Not found' }, { status: 404 }));
    } catch (err) {
      console.error(err);
      return cors(Response.json({ error: 'Internal server error' }, { status: 500 }));
    }
  },
};

export function cors(response: Response): Response {
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: h,
  });
}
```

- [ ] **Step 5: Run all tests — expect all pass**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm test 2>&1
```

Expected: all tests in all test files PASS. Fix any failures before committing.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/worker/routes/auth.ts src/worker/index.ts tests/worker/routes/auth.test.ts
git commit -m "feat: auth API routes — login, register, verify OTP, logout, me"
```

---

## Self-Review

**Spec coverage:**
- ✅ SMS OTP auth (createOtp, verifyOtp, sendOtpSms)
- ✅ JWT sessions — 12-hour TTL, stored in KV for server-side revocation
- ✅ Three roles enforced (admin/staff/volunteer) via requireRole middleware
- ✅ Self-registration for volunteers (POST /api/auth/register)
- ✅ question_settings table seeded with all 18 registration questions
- ✅ Admin-editable question config (table exists; admin UI comes in Plan 4)
- ✅ ENVIRONMENT=test guard prevents actual Twilio calls during tests

**Type consistency check:**
- `SessionPayload` defined in auth.ts, imported by middleware.ts ✅
- `AuthContext` in middleware.ts is `Pick<SessionPayload, ...>` ✅
- `normalizePhone` imported from db.ts in routes/auth.ts ✅
- `Env` type in schema.ts includes all required bindings (DB, SESSIONS, JWT_SECRET, TWILIO_*, ENVIRONMENT) ✅
- `verifyOtp` is dynamic-imported in routes/auth.ts — change to a static import at the top of the file to match the rest of the codebase ✅ (fix this before implementing)

**Fix before implementing:** In `routes/auth.ts` Step 3, the `verifyOtp` dynamic import inside `handleVerify` is unnecessary. Use a static import at the top of the file instead:
```typescript
import { createOtp, sendOtpSms, verifyOtp } from '../otp';
```
Remove the `const { verifyOtp } = await import('../otp');` line from inside `handleVerify`.
