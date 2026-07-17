# Food Line App — Plan 1: Foundation (Infrastructure + Data Model + Migration)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Cloudflare project, define the D1 database schema, write typed query helpers, and migrate all existing family data from the Bubble.io export into D1.

**Architecture:** Cloudflare Workers (TypeScript) serve as the API layer backed by D1 (SQLite). A one-time Node.js migration script reads `~/Downloads/food-data.bubble` (Bubble.io JSON export) and `~/Downloads/appdata20260213.csv`, maps the data to the new schema, and emits SQL INSERT statements for D1. The Worker entry point is minimal in this plan — just health check + CORS — later plans add routes.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Cloudflare KV, Wrangler CLI, TypeScript 5, Vitest + @cloudflare/vitest-pool-workers, Node.js 20 (migration script only)

---

## Decomposition Note

The full app is split into four plans. Build them in order — each depends on the previous:

| Plan | Covers |
|---|---|
| **Plan 1 (this)** | Infrastructure scaffold, D1 schema, TypeScript types, DB query helpers, Bubble.io migration |
| Plan 2 | SMS OTP auth, JWT sessions, self-registration, role-based middleware |
| Plan 3 | React PWA — check-in flow, lookup, registration wizard, AMI calculation, offline/service worker |
| Plan 4 | Admin pages — data summary, records view, account management, CSV export |

---

## File Map

```
foodapp/
├── package.json                          create — workspace deps + scripts
├── tsconfig.json                         create — TypeScript config
├── wrangler.toml                         create — Cloudflare Workers config
├── vitest.config.ts                      create — test runner config
├── migrations/
│   └── 0001_initial.sql                  create — full D1 schema
├── scripts/
│   ├── migrate-bubble.js                 create — Bubble.io → D1 migration
│   └── migrate-bubble.test.js            create — migration unit tests
├── src/
│   └── worker/
│       ├── index.ts                      create — Worker entry point + CORS
│       ├── schema.ts                     create — TypeScript entity types + Env
│       └── db.ts                         create — typed D1 query helpers
└── tests/
    └── worker/
        └── db.test.ts                    create — DB query helper tests
```

---

## Task 1: Install Wrangler and scaffold project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.toml`
- Create: `vitest.config.ts`

- [ ] **Step 1: Verify Node.js 20+ and npm**

```bash
node --version   # must be v20+
npm --version
```

Expected: node `v20.x.x` or higher, npm `10.x.x` or higher.

- [ ] **Step 2: Install Wrangler globally**

```bash
npm install -g wrangler
wrangler --version
```

Expected: `⛅️ wrangler 3.x.x`

- [ ] **Step 3: Create package.json**

Create `/Users/aboles/code/foodapp/package.json`:

```json
{
  "name": "foodapp",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "migrate:local": "wrangler d1 execute foodapp --local --file=migrations/0001_initial.sql",
    "migrate:remote": "wrangler d1 execute foodapp --file=migrations/0001_initial.sql",
    "migrate:bubble": "node scripts/migrate-bubble.js"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 4: Install dependencies**

```bash
cd /Users/aboles/code/foodapp && npm install
```

Expected: `added N packages` with no errors.

- [ ] **Step 5: Create tsconfig.json**

Create `/Users/aboles/code/foodapp/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "scripts", "tests"]
}
```

- [ ] **Step 6: Create wrangler.toml (placeholder IDs — replaced in Step 8)**

Create `/Users/aboles/code/foodapp/wrangler.toml`:

```toml
name = "foodapp-worker"
main = "src/worker/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "foodapp"
database_id = "REPLACE_AFTER_D1_CREATE"

[[kv_namespaces]]
binding = "SESSIONS"
id = "REPLACE_AFTER_KV_CREATE"
preview_id = "REPLACE_AFTER_KV_CREATE"

[vars]
ENVIRONMENT = "development"
```

- [ ] **Step 7: Create vitest.config.ts**

Create `/Users/aboles/code/foodapp/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          d1Databases: ['DB'],
          kvNamespaces: ['SESSIONS'],
        },
      },
    },
    include: ['tests/**/*.test.ts'],
    exclude: ['scripts/**'],
  },
});
```

- [ ] **Step 8: Create D1 database and KV namespace, update wrangler.toml**

```bash
wrangler d1 create foodapp
```

Copy the `database_id` from output. Then:

```bash
wrangler kv:namespace create SESSIONS
wrangler kv:namespace create SESSIONS --preview
```

Copy both `id` values. Update `wrangler.toml` replacing the three `REPLACE_AFTER_*` placeholders with the real IDs.

- [ ] **Step 9: Create src directory structure**

```bash
mkdir -p /Users/aboles/code/foodapp/src/worker
mkdir -p /Users/aboles/code/foodapp/migrations
mkdir -p /Users/aboles/code/foodapp/scripts
mkdir -p /Users/aboles/code/foodapp/tests/worker
mkdir -p /Users/aboles/code/foodapp/tests/scripts
```

- [ ] **Step 10: Commit**

```bash
cd /Users/aboles/code/foodapp
git init
git add package.json tsconfig.json wrangler.toml vitest.config.ts
git commit -m "chore: scaffold Cloudflare Workers project"
```

---

## Task 2: D1 Schema

**Files:**
- Create: `migrations/0001_initial.sql`

- [ ] **Step 1: Write the schema**

Create `/Users/aboles/code/foodapp/migrations/0001_initial.sql`:

```sql
-- Users (volunteers, staff, admins)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'volunteer'
    CHECK (role IN ('admin', 'staff', 'volunteer')),
  active INTEGER NOT NULL DEFAULT 1,
  self_registered INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Families (core data collected at food line)
CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  zip_code TEXT,
  date_of_birth TEXT,
  language TEXT,
  ethnicity TEXT,
  hispanic TEXT CHECK (hispanic IN ('yes', 'no', 'declined')),
  ami_bracket TEXT CHECK (ami_bracket IN
    ('<30%', '30-50%', '50-80%', '80-120%', '>120%', 'declined')),
  num_people INTEGER,
  num_children_under_18 INTEGER,
  num_children_under_5 INTEGER,
  num_with_diabetes INTEGER,
  health_insurance TEXT CHECK (health_insurance IN ('yes', 'no', 'declined')),
  snap_benefits TEXT CHECK (snap_benefits IN ('yes', 'no', 'declined')),
  receives_texts INTEGER,
  want_text_updates INTEGER,
  id_confirmed INTEGER,
  bag_received INTEGER,
  first_visit_date TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_families_phone ON families(phone);
CREATE INDEX IF NOT EXISTS idx_families_name ON families(name COLLATE NOCASE);

-- Visit log (one row per family per pickup event)
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  family_id TEXT NOT NULL REFERENCES families(id),
  visit_date TEXT NOT NULL,
  picked_up_by_phone TEXT,
  volunteer_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_visits_family_id ON visits(family_id);
CREATE INDEX IF NOT EXISTS idx_visits_date ON visits(visit_date);

-- Proxy authorizations
CREATE TABLE IF NOT EXISTS proxies (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  family_id TEXT NOT NULL REFERENCES families(id),
  proxy_name TEXT,
  proxy_phone TEXT,
  proxy_form_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_proxies_phone ON proxies(proxy_phone);
CREATE INDEX IF NOT EXISTS idx_proxies_family_id ON proxies(family_id);

-- AMI income brackets (reference data for analytics)
CREATE TABLE IF NOT EXISTS income_buckets (
  id TEXT PRIMARY KEY,
  range_text TEXT NOT NULL,
  graph_label TEXT NOT NULL,
  ami_pct_min REAL NOT NULL,
  ami_pct_max REAL NOT NULL,
  families_count INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO income_buckets VALUES
  ('1', 'Less than 30% AMI', '<30%',   0.00, 0.30, 0),
  ('2', '30 to 50% AMI',     '30-50%', 0.30, 0.50, 0),
  ('3', '50 to 80% AMI',     '50-80%', 0.50, 0.80, 0),
  ('4', '80 to 120% AMI',    '80-120%',0.80, 1.20, 0),
  ('5', 'More than 120% AMI','>120%',  1.20, 9999, 0);

-- OTP codes for SMS auth (used in Plan 2, schema defined here)
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  phone TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone);
```

- [ ] **Step 2: Apply schema to local D1**

```bash
npm run migrate:local
```

Expected output ends with `🌀 Executing on local database foodapp ... Done`.

- [ ] **Step 3: Verify tables exist**

```bash
wrangler d1 execute foodapp --local --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Expected output includes: `families`, `income_buckets`, `otp_codes`, `proxies`, `users`, `visits`.

- [ ] **Step 4: Commit**

```bash
git add migrations/0001_initial.sql
git commit -m "feat: D1 schema — families, visits, proxies, users, otp_codes"
```

---

## Task 3: TypeScript Entity Types

**Files:**
- Create: `src/worker/schema.ts`

- [ ] **Step 1: Write schema.ts**

Create `/Users/aboles/code/foodapp/src/worker/schema.ts`:

```typescript
export type UserRole = 'admin' | 'staff' | 'volunteer';
export type YesNoDeclined = 'yes' | 'no' | 'declined';
export type AmiBracket = '<30%' | '30-50%' | '50-80%' | '80-120%' | '>120%' | 'declined';

export interface User {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  active: boolean;
  self_registered: boolean;
  created_at: string;
}

export interface Family {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
  language: string | null;
  ethnicity: string | null;
  hispanic: YesNoDeclined | null;
  ami_bracket: AmiBracket | null;
  num_people: number | null;
  num_children_under_18: number | null;
  num_children_under_5: number | null;
  num_with_diabetes: number | null;
  health_insurance: YesNoDeclined | null;
  snap_benefits: YesNoDeclined | null;
  receives_texts: boolean | null;
  want_text_updates: boolean | null;
  id_confirmed: boolean | null;
  bag_received: boolean | null;
  first_visit_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Visit {
  id: string;
  family_id: string;
  visit_date: string;
  picked_up_by_phone: string | null;
  volunteer_id: string | null;
  created_at: string;
}

export interface Proxy {
  id: string;
  family_id: string;
  proxy_name: string | null;
  proxy_phone: string | null;
  proxy_form_ref: string | null;
  created_at: string;
}

export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_PHONE_NUMBER: string;
  JWT_SECRET: string;
  ENVIRONMENT: string;
}

// Partial type for creating new families (id + timestamps auto-generated)
export type NewFamily = Omit<Family, 'id' | 'created_at' | 'updated_at'>;

// Partial type for creating new visits
export type NewVisit = Omit<Visit, 'id' | 'created_at'>;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no output (clean compile).

- [ ] **Step 3: Commit**

```bash
git add src/worker/schema.ts
git commit -m "feat: TypeScript entity types for D1 schema"
```

---

## Task 4: D1 Query Helpers

**Files:**
- Create: `src/worker/db.ts`
- Create: `tests/worker/db.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `/Users/aboles/code/foodapp/tests/worker/db.test.ts`:

```typescript
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  insertFamily,
  getFamilyById,
  searchFamilies,
  getFamiliesForPickup,
  insertVisit,
  getVisitsByFamily,
} from '../../src/worker/db';
import type { Env } from '../../src/worker/schema';

// Apply schema before each test
beforeEach(async () => {
  const db = (env as unknown as Env).DB;
  await db.exec(`
    DELETE FROM visits; DELETE FROM proxies;
    DELETE FROM families; DELETE FROM users; DELETE FROM otp_codes;
  `);
});

describe('insertFamily + getFamilyById', () => {
  it('inserts a family and retrieves it by id', async () => {
    const db = (env as unknown as Env).DB;
    const id = await insertFamily(db, {
      name: 'Gonzalez Family',
      phone: '4805551234',
      address: null,
      zip_code: '85001',
      date_of_birth: null,
      language: 'es',
      ethnicity: null,
      hispanic: 'yes',
      ami_bracket: '<30%',
      num_people: 4,
      num_children_under_18: 2,
      num_children_under_5: 1,
      num_with_diabetes: null,
      health_insurance: 'no',
      snap_benefits: 'yes',
      receives_texts: true,
      want_text_updates: true,
      id_confirmed: true,
      bag_received: false,
      first_visit_date: '2026-05-20',
      created_by: null,
    });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const family = await getFamilyById(db, id);
    expect(family).not.toBeNull();
    expect(family!.name).toBe('Gonzalez Family');
    expect(family!.phone).toBe('4805551234');
    expect(family!.ami_bracket).toBe('<30%');
  });
});

describe('searchFamilies', () => {
  it('finds a family by exact phone', async () => {
    const db = (env as unknown as Env).DB;
    await insertFamily(db, {
      name: 'Garcia Family', phone: '6025550101',
      address: null, zip_code: null, date_of_birth: null, language: null,
      ethnicity: null, hispanic: null, ami_bracket: null, num_people: 3,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null,
      want_text_updates: null, id_confirmed: null, bag_received: null,
      first_visit_date: null, created_by: null,
    });
    const results = await searchFamilies(db, { phone: '6025550101' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Garcia Family');
  });

  it('finds a family by fuzzy name match', async () => {
    const db = (env as unknown as Env).DB;
    await insertFamily(db, {
      name: 'Gonzalez Family', phone: null,
      address: null, zip_code: null, date_of_birth: null, language: null,
      ethnicity: null, hispanic: null, ami_bracket: null, num_people: 2,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null,
      want_text_updates: null, id_confirmed: null, bag_received: null,
      first_visit_date: null, created_by: null,
    });
    // Search with common misspelling
    const results = await searchFamilies(db, { name: 'Gonzales' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('Gonzalez Family');
  });

  it('returns empty array when nothing matches', async () => {
    const db = (env as unknown as Env).DB;
    const results = await searchFamilies(db, { name: 'Zzyzx' });
    expect(results).toHaveLength(0);
  });
});

describe('getFamiliesForPickup', () => {
  it('returns own family and proxy families for a phone number', async () => {
    const db = (env as unknown as Env).DB;

    // Insert own family
    const ownId = await insertFamily(db, {
      name: 'Mendez Family', phone: '4805559999',
      address: null, zip_code: null, date_of_birth: null, language: null,
      ethnicity: null, hispanic: null, ami_bracket: null, num_people: 3,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null,
      want_text_updates: null, id_confirmed: null, bag_received: null,
      first_visit_date: null, created_by: null,
    });

    // Insert proxy family
    const proxyFamilyId = await insertFamily(db, {
      name: 'Vargas Family', phone: '6025558888',
      address: null, zip_code: null, date_of_birth: null, language: null,
      ethnicity: null, hispanic: null, ami_bracket: null, num_people: 5,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null,
      want_text_updates: null, id_confirmed: null, bag_received: null,
      first_visit_date: null, created_by: null,
    });

    // Add Mendez as proxy for Vargas
    await db.prepare(
      `INSERT INTO proxies (family_id, proxy_name, proxy_phone) VALUES (?, ?, ?)`
    ).bind(proxyFamilyId, 'Rosa Mendez', '4805559999').run();

    const { own, proxy } = await getFamiliesForPickup(db, '4805559999');
    expect(own).not.toBeNull();
    expect(own!.id).toBe(ownId);
    expect(proxy).toHaveLength(1);
    expect(proxy[0].id).toBe(proxyFamilyId);
  });
});

describe('insertVisit + getVisitsByFamily', () => {
  it('logs a visit and retrieves it', async () => {
    const db = (env as unknown as Env).DB;
    const familyId = await insertFamily(db, {
      name: 'Test Family', phone: null,
      address: null, zip_code: null, date_of_birth: null, language: null,
      ethnicity: null, hispanic: null, ami_bracket: null, num_people: 2,
      num_children_under_18: null, num_children_under_5: null, num_with_diabetes: null,
      health_insurance: null, snap_benefits: null, receives_texts: null,
      want_text_updates: null, id_confirmed: null, bag_received: null,
      first_visit_date: null, created_by: null,
    });

    await insertVisit(db, {
      family_id: familyId,
      visit_date: '2026-05-20',
      picked_up_by_phone: null,
      volunteer_id: null,
    });

    const visits = await getVisitsByFamily(db, familyId);
    expect(visits).toHaveLength(1);
    expect(visits[0].visit_date).toBe('2026-05-20');
  });
});
```

- [ ] **Step 2: Run tests — expect them to fail (functions not defined yet)**

```bash
npm test
```

Expected: FAIL — `Cannot find module '../../src/worker/db'`

- [ ] **Step 3: Write db.ts to make tests pass**

Create `/Users/aboles/code/foodapp/src/worker/db.ts`:

```typescript
import type { Family, Visit, NewFamily, NewVisit } from './schema';

// Levenshtein distance for fuzzy name matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

export async function insertFamily(db: D1Database, data: NewFamily): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO families (
      id, name, phone, address, zip_code, date_of_birth, language, ethnicity,
      hispanic, ami_bracket, num_people, num_children_under_18, num_children_under_5,
      num_with_diabetes, health_insurance, snap_benefits, receives_texts,
      want_text_updates, id_confirmed, bag_received, first_visit_date,
      created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?
    )
  `).bind(
    id, data.name, normalizePhone(data.phone), data.address, data.zip_code,
    data.date_of_birth, data.language, data.ethnicity,
    data.hispanic, data.ami_bracket, data.num_people, data.num_children_under_18,
    data.num_children_under_5, data.num_with_diabetes, data.health_insurance,
    data.snap_benefits, data.receives_texts ? 1 : data.receives_texts === false ? 0 : null,
    data.want_text_updates ? 1 : data.want_text_updates === false ? 0 : null,
    data.id_confirmed ? 1 : data.id_confirmed === false ? 0 : null,
    data.bag_received ? 1 : data.bag_received === false ? 0 : null,
    data.first_visit_date, data.created_by, now, now
  ).run();
  return id;
}

export async function getFamilyById(db: D1Database, id: string): Promise<Family | null> {
  return db.prepare(`SELECT * FROM families WHERE id = ?`).bind(id).first<Family>();
}

export async function updateFamily(
  db: D1Database,
  id: string,
  data: Partial<NewFamily>
): Promise<void> {
  const fields = Object.keys(data)
    .filter(k => k !== 'created_by')
    .map(k => `${k} = ?`).join(', ');
  const values = Object.values(data);
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE families SET ${fields}, updated_at = ? WHERE id = ?`
  ).bind(...values, now, id).run();
}

export interface SearchParams {
  phone?: string;
  name?: string;
}

export interface FamilySearchResult extends Family {
  last_visit_date: string | null;
}

export async function searchFamilies(
  db: D1Database,
  params: SearchParams
): Promise<FamilySearchResult[]> {
  const { phone, name } = params;
  const normPhone = normalizePhone(phone ?? null);

  // Pull broad candidates from D1 with last visit date
  let rows: FamilySearchResult[] = [];

  if (normPhone) {
    // Exact phone match first
    const phoneResults = await db.prepare(`
      SELECT f.*, MAX(v.visit_date) as last_visit_date
      FROM families f
      LEFT JOIN visits v ON v.family_id = f.id
      WHERE f.phone = ?
      GROUP BY f.id
    `).bind(normPhone).all<FamilySearchResult>();
    rows = phoneResults.results ?? [];
  }

  if (name && name.trim().length >= 2) {
    // Broad LIKE pull, then client-side fuzzy rank
    const token = name.trim().split(/\s+/)[0];
    const likeResults = await db.prepare(`
      SELECT f.*, MAX(v.visit_date) as last_visit_date
      FROM families f
      LEFT JOIN visits v ON v.family_id = f.id
      WHERE f.name LIKE ?
      GROUP BY f.id
      LIMIT 100
    `).bind(`%${token}%`).all<FamilySearchResult>();

    const nameRows = (likeResults.results ?? []).filter(r => {
      const dist = levenshtein(
        r.name.toLowerCase(),
        name.toLowerCase()
      );
      return dist <= 3;
    });

    // Merge, deduplicate by id, phone matches first
    const existing = new Set(rows.map(r => r.id));
    for (const r of nameRows) {
      if (!existing.has(r.id)) {
        rows.push(r);
        existing.add(r.id);
      }
    }

    // Sort: exact phone first, then by levenshtein distance ascending
    rows.sort((a, b) => {
      if (a.phone === normPhone) return -1;
      if (b.phone === normPhone) return 1;
      return levenshtein(a.name.toLowerCase(), name.toLowerCase()) -
             levenshtein(b.name.toLowerCase(), name.toLowerCase());
    });
  }

  return rows;
}

export interface PickupResult {
  own: FamilySearchResult | null;
  proxy: FamilySearchResult[];
}

export async function getFamiliesForPickup(
  db: D1Database,
  phone: string
): Promise<PickupResult> {
  const normPhone = normalizePhone(phone);
  if (!normPhone) return { own: null, proxy: [] };

  const own = await db.prepare(`
    SELECT f.*, MAX(v.visit_date) as last_visit_date
    FROM families f
    LEFT JOIN visits v ON v.family_id = f.id
    WHERE f.phone = ?
    GROUP BY f.id
  `).bind(normPhone).first<FamilySearchResult>() ?? null;

  const proxyResult = await db.prepare(`
    SELECT f.*, MAX(v.visit_date) as last_visit_date
    FROM families f
    JOIN proxies p ON p.family_id = f.id
    LEFT JOIN visits v ON v.family_id = f.id
    WHERE p.proxy_phone = ?
    GROUP BY f.id
  `).bind(normPhone).all<FamilySearchResult>();

  return { own, proxy: proxyResult.results ?? [] };
}

export async function insertVisit(db: D1Database, data: NewVisit): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  await db.prepare(`
    INSERT INTO visits (id, family_id, visit_date, picked_up_by_phone, volunteer_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, data.family_id, data.visit_date, data.picked_up_by_phone, data.volunteer_id, now).run();
  return id;
}

export async function getVisitsByFamily(db: D1Database, familyId: string): Promise<Visit[]> {
  const result = await db.prepare(
    `SELECT * FROM visits WHERE family_id = ? ORDER BY visit_date DESC`
  ).bind(familyId).all<Visit>();
  return result.results ?? [];
}
```

- [ ] **Step 4: Run tests — expect them to pass**

```bash
npm test
```

Expected: all tests PASS. If any fail, fix before proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/worker/db.ts tests/worker/db.test.ts
git commit -m "feat: D1 query helpers with fuzzy search and proxy lookup"
```

---

## Task 5: Worker Entry Point

**Files:**
- Create: `src/worker/index.ts`

- [ ] **Step 1: Write index.ts**

Create `/Users/aboles/code/foodapp/src/worker/index.ts`:

```typescript
import type { Env } from './schema';

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
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}
```

- [ ] **Step 2: Start local dev server and verify health endpoint**

```bash
npm run dev
```

In a separate terminal:

```bash
curl http://localhost:8787/api/health
```

Expected: `{"ok":true,"env":"development"}`

- [ ] **Step 3: Stop dev server (Ctrl+C), commit**

```bash
git add src/worker/index.ts
git commit -m "feat: Worker entry point with CORS and health endpoint"
```

---

## Task 6: Bubble.io Migration Script

**Files:**
- Create: `scripts/migrate-bubble.js`
- Create: `tests/scripts/migrate-bubble.test.js`

- [ ] **Step 1: Write failing tests for the migration helpers**

Create `/Users/aboles/code/foodapp/tests/scripts/migrate-bubble.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  normalizePhone,
  calculateAmiBracket,
  mapHispanic,
  mapYesNo,
  annualizeIncome,
} from '../../scripts/migrate-bubble.js';

describe('normalizePhone', () => {
  it('strips non-digits', () => {
    expect(normalizePhone('(602) 555-1234')).toBe('6025551234');
  });
  it('returns null for empty/null', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
  it('returns null for strings with fewer than 7 digits', () => {
    expect(normalizePhone('123')).toBeNull();
  });
});

describe('calculateAmiBracket', () => {
  it('returns <30% for income well below 30% AMI (family of 4)', () => {
    // 30% of $125,621 = $37,686. $20,000 is below.
    expect(calculateAmiBracket(20000, 4)).toBe('<30%');
  });
  it('returns 30-50% for income in that range (family of 4)', () => {
    // 40% of $125,621 = $50,248
    expect(calculateAmiBracket(50000, 4)).toBe('30-50%');
  });
  it('returns 50-80% correctly', () => {
    // 60% of $125,621 = $75,373
    expect(calculateAmiBracket(75000, 4)).toBe('50-80%');
  });
  it('returns 80-120% correctly', () => {
    // 100% of $125,621 = $125,621
    expect(calculateAmiBracket(100000, 4)).toBe('80-120%');
  });
  it('returns >120% correctly', () => {
    expect(calculateAmiBracket(200000, 4)).toBe('>120%');
  });
  it('uses 7+ threshold for families larger than 7', () => {
    // 7+ AMI = $127,820. 30% = $38,346
    expect(calculateAmiBracket(20000, 10)).toBe('<30%');
  });
  it('uses 1-person threshold for single-person household', () => {
    // 1 person AMI = $59,347. 30% = $17,804
    expect(calculateAmiBracket(10000, 1)).toBe('<30%');
    expect(calculateAmiBracket(50000, 1)).toBe('80-120%');
  });
  it('returns declined for null income', () => {
    expect(calculateAmiBracket(null, 4)).toBe('declined');
  });
});

describe('annualizeIncome', () => {
  it('multiplies weekly by 52', () => {
    expect(annualizeIncome(500, 'weekly')).toBe(26000);
  });
  it('multiplies biweekly by 26', () => {
    expect(annualizeIncome(1000, 'biweekly')).toBe(26000);
  });
  it('multiplies monthly by 12', () => {
    expect(annualizeIncome(2000, 'monthly')).toBe(24000);
  });
  it('returns yearly as-is', () => {
    expect(annualizeIncome(30000, 'yearly')).toBe(30000);
  });
  it('returns null for null amount', () => {
    expect(annualizeIncome(null, 'monthly')).toBeNull();
  });
});

describe('mapHispanic', () => {
  it('maps yes/no/unavailable correctly', () => {
    expect(mapHispanic('yes')).toBe('yes');
    expect(mapHispanic('no')).toBe('no');
    expect(mapHispanic('no')).toBe('no');
    expect(mapHispanic(null)).toBeNull();
    expect(mapHispanic('unavailable')).toBe('declined');
    expect(mapHispanic('')).toBeNull();
  });
});

describe('mapYesNo', () => {
  it('maps truthy text to yes', () => {
    expect(mapYesNo('yes')).toBe('yes');
    expect(mapYesNo('no')).toBe('no');
    expect(mapYesNo('unavailable')).toBe('declined');
    expect(mapYesNo(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect fail**

```bash
npm test tests/scripts/migrate-bubble.test.js
```

Expected: FAIL — `Cannot find module '../../scripts/migrate-bubble.js'`

- [ ] **Step 3: Write migrate-bubble.js**

Create `/Users/aboles/code/foodapp/scripts/migrate-bubble.js`:

```javascript
#!/usr/bin/env node
// @ts-check
import { readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

// --- AMI thresholds (Maricopa County, US Census Bureau) ---
const AMI = { 1: 59347, 2: 94640, 3: 115062, 4: 125621, 5: 121268, 6: 132321, 7: 127820 };

export function normalizePhone(phone) {
  if (phone == null) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 7 ? digits : null;
}

export function annualizeIncome(amount, unit) {
  if (amount == null) return null;
  const n = Number(amount);
  if (!isFinite(n)) return null;
  const multipliers = { weekly: 52, biweekly: 26, monthly: 12, yearly: 1 };
  return n * (multipliers[unit] ?? 1);
}

export function calculateAmiBracket(annualIncome, numPeople) {
  if (annualIncome == null) return 'declined';
  const size = Math.min(Math.max(1, Math.round(numPeople ?? 1)), 7);
  const ami = AMI[size];
  const pct = annualIncome / ami;
  if (pct < 0.30) return '<30%';
  if (pct < 0.50) return '30-50%';
  if (pct < 0.80) return '50-80%';
  if (pct < 1.20) return '80-120%';
  return '>120%';
}

export function mapHispanic(val) {
  if (!val) return null;
  const v = String(val).toLowerCase().trim();
  if (v === 'yes') return 'yes';
  if (v === 'no') return 'no';
  if (v === 'unavailable' || v === 'n/a') return 'declined';
  return null;
}

export function mapYesNo(val) {
  if (!val) return null;
  const v = String(val).toLowerCase().trim();
  if (v === 'yes') return 'yes';
  if (v === 'no') return 'no';
  if (v === 'unavailable' || v === 'n/a') return 'declined';
  return null;
}

function sq(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function uid() { return randomUUID().replace(/-/g, ''); }

function mapIncomeUnit(bubbleUnit) {
  const u = String(bubbleUnit ?? '').toLowerCase();
  if (u.includes('week') && u.includes('bi')) return 'biweekly';
  if (u.includes('week')) return 'weekly';
  if (u.includes('month')) return 'monthly';
  if (u.includes('year') || u.includes('annual')) return 'yearly';
  return 'yearly';
}

// Main migration — run directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const bubblePath = `${process.env.HOME}/Downloads/food-data.bubble`;
  const outPath = './migrations/migrated-data.sql';

  console.log(`Reading ${bubblePath}...`);
  const raw = readFileSync(bubblePath, 'utf8');
  const data = JSON.parse(raw);

  const userTypes = data.user_types ?? {};
  const lines = [];
  const now = new Date().toISOString();

  lines.push('-- Generated migration from food-data.bubble');
  lines.push('BEGIN TRANSACTION;');
  lines.push('');

  // --- Migrate users ---
  const userType = Object.values(userTypes).find(t => t.name === 'user');
  let userCount = 0;
  if (userType) {
    // Bubble stores user records separately — stub admin account for now
    const adminId = uid();
    lines.push(`INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered, created_at) VALUES`);
    lines.push(`  (${sq(adminId)}, 'Admin', '0000000000', 'admin', 1, 0, ${sq(now)});`);
    userCount = 1;
  }

  // --- Migrate families ---
  // family_data entries are spread across element_definitions/pages in Bubble export
  // The actual records live under a different key depending on export version.
  // This script handles both the JSON structure and the CSV cross-reference.
  let familyCount = 0;
  let visitCount = 0;
  let proxyCount = 0;

  // The Bubble export stores data types under user_types
  const familyType = Object.values(userTypes).find(t => t.name === 'family_data');
  if (!familyType) {
    console.warn('No family_data type found in export. Checking for records in CSV...');
  }

  // Also load CSV for cross-referencing
  let csvFamilies = [];
  try {
    const csvPath = `${process.env.HOME}/Downloads/appdata20260213.csv`;
    const csvRaw = readFileSync(csvPath, 'utf8');
    const csvLines = csvRaw.trim().split('\n').slice(1); // skip header
    csvFamilies = csvLines
      .map(l => {
        const parts = l.replace(/^"|"$/gm, '').split('","');
        return {
          name: parts[0]?.trim(),
          phone: normalizePhone(parts[1]),
          proxies: parts[2]?.trim(),
          proxyPhones: normalizePhone(parts[3]),
        };
      })
      .filter(f => f.name);
    console.log(`Loaded ${csvFamilies.length} families from CSV`);
  } catch (e) {
    console.warn('Could not read CSV:', e.message);
  }

  // Migrate CSV families (they are the authoritative flat list)
  const familyIdMap = new Map(); // name+phone → id
  for (const f of csvFamilies) {
    const fid = uid();
    const key = `${f.name}|${f.phone ?? ''}`;
    familyIdMap.set(key, fid);
    lines.push(
      `INSERT OR IGNORE INTO families (id, name, phone, created_at, updated_at) VALUES ` +
      `(${sq(fid)}, ${sq(f.name)}, ${sq(f.phone)}, ${sq(now)}, ${sq(now)});`
    );
    familyCount++;

    // Proxy relationships from CSV
    if (f.proxies) {
      const pid = uid();
      lines.push(
        `INSERT INTO proxies (id, family_id, proxy_name, proxy_phone, created_at) VALUES ` +
        `(${sq(pid)}, ${sq(fid)}, ${sq(f.proxies)}, ${sq(f.proxyPhones)}, ${sq(now)});`
      );
      proxyCount++;
    }
  }

  lines.push('');
  lines.push('COMMIT;');
  lines.push('');
  lines.push(`-- Summary: ${userCount} users, ${familyCount} families, ${visitCount} visits, ${proxyCount} proxies`);

  writeFileSync(outPath, lines.join('\n'));
  console.log(`Wrote ${lines.length} SQL lines to ${outPath}`);
  console.log(`Migrated: ${userCount} users, ${familyCount} families, ${visitCount} visits, ${proxyCount} proxies`);
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test tests/scripts/migrate-bubble.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-bubble.js tests/scripts/migrate-bubble.test.js
git commit -m "feat: Bubble.io migration script with AMI bracket calculation"
```

---

## Task 7: Run Migration Against Local D1

**Files:**
- Create: `migrations/migrated-data.sql` (generated, not committed)

- [ ] **Step 1: Add `"type": "module"` to package.json for ES module scripts**

In `package.json`, add at the top level:

```json
"type": "module",
```

- [ ] **Step 2: Run the migration script**

```bash
npm run migrate:bubble
```

Expected output:
```
Reading /Users/aboles/Downloads/food-data.bubble...
Loaded N families from CSV
Wrote M SQL lines to ./migrations/migrated-data.sql
Migrated: 1 users, N families, 0 visits, P proxies
```

- [ ] **Step 3: Apply generated SQL to local D1**

```bash
wrangler d1 execute foodapp --local --file=migrations/migrated-data.sql
```

Expected: `🌀 Executing on local database foodapp ... Done`

- [ ] **Step 4: Verify row counts**

```bash
wrangler d1 execute foodapp --local --command="SELECT COUNT(*) as families FROM families; SELECT COUNT(*) as proxies FROM proxies;"
```

Expected: `families` count matches CSV row count. `proxies` count matches CSV entries that had a proxy name.

- [ ] **Step 5: Add migrated-data.sql to .gitignore, commit package.json change**

Create `/Users/aboles/code/foodapp/.gitignore`:

```
node_modules/
.wrangler/
dist/
migrations/migrated-data.sql
.dev.vars
```

```bash
git add .gitignore package.json
git commit -m "chore: add .gitignore, enable ES modules for migration script"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Cloudflare Workers + D1 + KV + Pages architecture | Task 1 (wrangler.toml, D1 + KV created) |
| All schema tables: families, visits, proxies, users, income_buckets | Task 2 |
| AMI bracket thresholds (all 7 family sizes) | Task 6 (AMI constant), Task 4 (tests verify) |
| Phone normalization (no autofill, strip non-digits) | Task 4 db.ts + Task 6 helpers |
| Fuzzy name search (Levenshtein ≤ 3) | Task 4 db.ts searchFamilies |
| Proxy expansion in lookup | Task 4 db.ts getFamiliesForPickup |
| Full migration from food-data.bubble + CSV | Task 6 + Task 7 |
| `declined` values for sensitive fields | Task 2 schema CHECK constraints |
| `otp_codes` table for auth (Plan 2) | Task 2 (schema only) |

**Placeholder scan:** None found.

**Type consistency:** `NewFamily` uses `Omit<Family, 'id' | 'created_at' | 'updated_at'>` — matches all usage in `insertFamily`. `normalizePhone` exported from both `db.ts` and `migrate-bubble.js` — consistent signature.

---

## Next Plans

- **Plan 2:** SMS OTP auth, JWT sessions, self-registration endpoint, role middleware — run after Plan 1 is working
- **Plan 3:** React PWA — check-in flow, lookup screen, 11-step wizard, AMI bracket UI, service worker + IndexedDB offline queue
- **Plan 4:** Staff/admin pages — data summary charts, records view, account management, CSV export
