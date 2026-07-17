# React PWA Check-In Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Worker API endpoints (families, visits, questions) and the complete React PWA check-in flow replacing the Bubble.io volunteer interface.

**Architecture:** React 18 + React Router v6 SPA in `src/pwa/`, served by Cloudflare Pages. The Worker gains three new route files. All check-in state lives in `EnterPage.tsx` as a typed discriminated-union state machine. IndexedDB queues failed submissions for offline resilience. Hand-written service worker caches the app shell.

**Tech Stack:** React 18, React Router v6, TypeScript, Vite 5, CSS custom properties; Cloudflare Workers D1 + KV; Vitest + `@cloudflare/vitest-pool-workers` (Worker tests); Vitest node env (ami unit tests).

## Global Constraints

- All interactive elements minimum 48×48px touch target (`--touch: 48px`)
- Question text 20px+; body 16px minimum
- Dark high-contrast CSS-custom-property theme (`--bg: #121212`)
- Every wizard question shows full English AND Spanish sentences, equal size, no directional labels
- Raw income amount and pay period NEVER sent to server — only calculated `ami_bracket` stored
- Worker test command: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run`
- PWA unit test command: `export PATH="/opt/homebrew/bin:$PATH" && npx vitest run --config vitest.pwa.config.ts`
- Dev: Worker on :8787 (`npm run dev`), Vite on :5173 (`npm run pwa:dev`)
- NEVER commit `.dev.vars`

---

### Task 1: Worker API routes — families, visits, questions

**Files:**
- Create: `src/worker/routes/families.ts`
- Create: `src/worker/routes/visits.ts`
- Create: `src/worker/routes/questions.ts`
- Modify: `src/worker/index.ts`
- Create: `tests/worker/routes/families.test.ts`
- Create: `tests/worker/routes/visits.test.ts`
- Create: `tests/worker/routes/questions.test.ts`

**Interfaces:**
- Consumes: `searchFamilies`, `getFamiliesForPickup`, `getFamilyById`, `insertFamily`, `updateFamily` from `src/worker/db.ts`; `insertVisit`, `getVisitsByFamily` from `src/worker/db.ts`; `getAuthContext` from `src/worker/middleware.ts`; `QuestionSetting` from `src/worker/schema.ts`
- Produces: `handleFamilyRoutes(request, env, pathname)`, `handleVisitRoutes(request, env, pathname)`, `handleQuestionRoutes(request, env, pathname)` — all return `Promise<Response | null>`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/worker/routes/families.test.ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { buildSession, createSession } from '../../../src/worker/auth';
import type { Env } from '../../../src/worker/schema';

const USER_ID = 'testfamilyuser01';
const USER_PHONE = '4805550100';
let authHeader: string;

async function insertFamily(name: string, phone?: string): Promise<string> {
  const e = env as unknown as Env;
  const id = crypto.randomUUID().replace(/-/g, '');
  await e.DB.prepare(
    `INSERT INTO families (id, name, phone, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`
  ).bind(id, name, phone ?? null).run();
  return id;
}

beforeAll(async () => {
  const e = env as unknown as Env;
  await e.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered) VALUES (?, 'Family Tester', ?, 'volunteer', 1, 1)`
  ).bind(USER_ID, USER_PHONE).run();
  const { token, payload } = await buildSession(USER_ID, USER_PHONE, 'volunteer', e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  authHeader = `Bearer ${token}`;
});

describe('GET /api/families/search', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://example.com/api/families/search?name=Smith');
    expect(res.status).toBe(401);
  });

  it('returns 400 without name or phone', async () => {
    const res = await SELF.fetch('http://example.com/api/families/search', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(400);
  });

  it('returns results by name', async () => {
    await insertFamily('Smith Family');
    const res = await SELF.fetch('http://example.com/api/families/search?name=Smith', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ results: unknown[] }>();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results.length).toBeGreaterThan(0);
  });
});

describe('GET /api/families/pickup', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://example.com/api/families/pickup?phone=4805550200');
    expect(res.status).toBe(401);
  });

  it('returns 400 without phone', async () => {
    const res = await SELF.fetch('http://example.com/api/families/pickup', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(400);
  });

  it('returns own family when phone matches', async () => {
    await insertFamily('Pickup Family', '4805550200');
    const res = await SELF.fetch('http://example.com/api/families/pickup?phone=4805550200', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ own: { name: string } | null; proxy: unknown[] }>();
    expect(data.own?.name).toBe('Pickup Family');
  });
});

describe('POST /api/families', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 without name', async () => {
    const res = await SELF.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('creates family and returns id', async () => {
    const res = await SELF.fetch('http://example.com/api/families', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ name: 'New Family', num_people: 3 }),
    });
    expect(res.status).toBe(201);
    const data = await res.json<{ id: string }>();
    expect(typeof data.id).toBe('string');
    expect(data.id.length).toBeGreaterThan(0);
  });
});

describe('PATCH /api/families/:id', () => {
  it('returns 401 without auth', async () => {
    const id = await insertFamily('Patch Target');
    const res = await SELF.fetch(`http://example.com/api/families/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ num_people: 5 }),
    });
    expect(res.status).toBe(401);
  });

  it('updates family', async () => {
    const id = await insertFamily('Patchable');
    const res = await SELF.fetch(`http://example.com/api/families/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ num_people: 5 }),
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ ok: boolean }>();
    expect(data.ok).toBe(true);
  });
});
```

```typescript
// tests/worker/routes/visits.test.ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { buildSession, createSession } from '../../../src/worker/auth';
import type { Env } from '../../../src/worker/schema';

const USER_ID = 'testvisituser001';
const USER_PHONE = '4805550101';
let authHeader: string;
let testFamilyId: string;

beforeAll(async () => {
  const e = env as unknown as Env;
  await e.DB.prepare(
    `INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered) VALUES (?, 'Visit Tester', ?, 'volunteer', 1, 1)`
  ).bind(USER_ID, USER_PHONE).run();
  const { token, payload } = await buildSession(USER_ID, USER_PHONE, 'volunteer', e.JWT_SECRET);
  await createSession(e.SESSIONS, payload);
  authHeader = `Bearer ${token}`;
  testFamilyId = crypto.randomUUID().replace(/-/g, '');
  await e.DB.prepare(
    `INSERT INTO families (id, name, created_at, updated_at) VALUES (?, 'Visit Family', datetime('now'), datetime('now'))`
  ).bind(testFamilyId).run();
});

describe('POST /api/visits', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ family_id: testFamilyId }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 without family_id', async () => {
    const res = await SELF.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('creates visit and returns id', async () => {
    const res = await SELF.fetch('http://example.com/api/visits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({ family_id: testFamilyId }),
    });
    expect(res.status).toBe(201);
    const data = await res.json<{ id: string }>();
    expect(typeof data.id).toBe('string');
  });
});

describe('GET /api/visits', () => {
  it('returns 401 without auth', async () => {
    const res = await SELF.fetch(`http://example.com/api/visits?familyId=${testFamilyId}`);
    expect(res.status).toBe(401);
  });

  it('returns 400 without familyId', async () => {
    const res = await SELF.fetch('http://example.com/api/visits', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(400);
  });

  it('returns visits array', async () => {
    const res = await SELF.fetch(`http://example.com/api/visits?familyId=${testFamilyId}`, {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const data = await res.json<{ visits: unknown[] }>();
    expect(Array.isArray(data.visits)).toBe(true);
  });
});
```

```typescript
// tests/worker/routes/questions.test.ts
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /api/questions', () => {
  it('returns questions array (no auth required)', async () => {
    const res = await SELF.fetch('http://example.com/api/questions');
    expect(res.status).toBe(200);
    const data = await res.json<{ questions: unknown[] }>();
    expect(Array.isArray(data.questions)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npx vitest run tests/worker/routes/families.test.ts tests/worker/routes/visits.test.ts tests/worker/routes/questions.test.ts
```

Expected: FAIL — routes not found (404s)

- [ ] **Step 3: Implement `src/worker/routes/families.ts`**

```typescript
import type { Env } from '../schema';
import { getAuthContext } from '../middleware';
import {
  searchFamilies, getFamiliesForPickup, getFamilyById,
  insertFamily, updateFamily,
} from '../db';
import type { NewFamily } from '../schema';

export async function handleFamilyRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/families/search' && request.method === 'GET') {
    return handleSearch(request, env);
  }
  if (pathname === '/api/families/pickup' && request.method === 'GET') {
    return handlePickup(request, env);
  }
  if (pathname === '/api/families' && request.method === 'POST') {
    return handleCreate(request, env);
  }
  const idMatch = pathname.match(/^\/api\/families\/([a-f0-9]+)$/);
  if (idMatch) {
    if (request.method === 'GET') return handleGet(request, env, idMatch[1]);
    if (request.method === 'PATCH') return handleUpdate(request, env, idMatch[1]);
  }
  return null;
}

async function handleSearch(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const name = url.searchParams.get('name') ?? undefined;
  const phone = url.searchParams.get('phone') ?? undefined;
  if (!name && !phone) {
    return Response.json({ error: 'name or phone is required' }, { status: 400 });
  }
  const results = await searchFamilies(env.DB, { name, phone });
  return Response.json({ results });
}

async function handlePickup(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) return Response.json({ error: 'phone is required' }, { status: 400 });
  const result = await getFamiliesForPickup(env.DB, phone);
  return Response.json(result);
}

async function handleGet(request: Request, env: Env, id: string): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const family = await getFamilyById(env.DB, id);
  if (!family) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(family);
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json<Partial<NewFamily> & { proxy?: { proxy_name: string; proxy_phone: string | null } }>();
  if (!body.name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  const data: NewFamily = {
    name: body.name.trim(),
    phone: body.phone ?? null,
    address: body.address ?? null,
    zip_code: body.zip_code ?? null,
    date_of_birth: body.date_of_birth ?? null,
    language: body.language ?? null,
    ethnicity: body.ethnicity ?? null,
    hispanic: body.hispanic ?? null,
    ami_bracket: body.ami_bracket ?? null,
    num_people: body.num_people ?? null,
    num_children_under_18: body.num_children_under_18 ?? null,
    num_children_under_5: body.num_children_under_5 ?? null,
    num_with_diabetes: body.num_with_diabetes ?? null,
    health_insurance: body.health_insurance ?? null,
    snap_benefits: body.snap_benefits ?? null,
    receives_texts: body.receives_texts ?? null,
    want_text_updates: body.want_text_updates ?? null,
    id_confirmed: body.id_confirmed ?? null,
    bag_received: body.bag_received ?? null,
    first_visit_date: body.first_visit_date ?? null,
    created_by: ctx.userId,
  };
  const id = await insertFamily(env.DB, data);
  if (body.proxy) {
    const proxyId = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare(
      `INSERT INTO proxies (id, family_id, proxy_name, proxy_phone, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(proxyId, id, body.proxy.proxy_name, body.proxy.proxy_phone).run();
  }
  return Response.json({ id }, { status: 201 });
}

async function handleUpdate(request: Request, env: Env, id: string): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json<Partial<NewFamily>>();
  await updateFamily(env.DB, id, body);
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Implement `src/worker/routes/visits.ts`**

```typescript
import type { Env, NewVisit } from '../schema';
import { getAuthContext } from '../middleware';
import { insertVisit, getVisitsByFamily } from '../db';

export async function handleVisitRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/visits' && request.method === 'POST') {
    return handleCreate(request, env);
  }
  if (pathname === '/api/visits' && request.method === 'GET') {
    return handleGet(request, env);
  }
  return null;
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json<{ family_id?: string; visit_date?: string; picked_up_by_phone?: string }>();
  if (!body.family_id) return Response.json({ error: 'family_id is required' }, { status: 400 });
  const data: NewVisit = {
    family_id: body.family_id,
    visit_date: body.visit_date ?? new Date().toISOString().slice(0, 10),
    picked_up_by_phone: body.picked_up_by_phone ?? null,
    volunteer_id: ctx.userId,
  };
  const id = await insertVisit(env.DB, data);
  return Response.json({ id }, { status: 201 });
}

async function handleGet(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const familyId = url.searchParams.get('familyId');
  if (!familyId) return Response.json({ error: 'familyId is required' }, { status: 400 });
  const visits = await getVisitsByFamily(env.DB, familyId);
  return Response.json({ visits });
}
```

- [ ] **Step 5: Implement `src/worker/routes/questions.ts`**

```typescript
import type { Env, QuestionSetting } from '../schema';

export async function handleQuestionRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/questions' && request.method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT * FROM question_settings WHERE visible = 1 ORDER BY display_order ASC`
    ).all<QuestionSetting>();
    return Response.json({ questions: result.results ?? [] });
  }
  return null;
}
```

- [ ] **Step 6: Wire new routes into `src/worker/index.ts`**

```typescript
import type { Env } from './schema';
import { handleAuthRoutes } from './routes/auth';
import { handleFamilyRoutes } from './routes/families';
import { handleVisitRoutes } from './routes/visits';
import { handleQuestionRoutes } from './routes/questions';

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

      const familyResponse = await handleFamilyRoutes(request, env, url.pathname);
      if (familyResponse) return cors(familyResponse);

      const visitResponse = await handleVisitRoutes(request, env, url.pathname);
      if (visitResponse) return cors(visitResponse);

      const questionResponse = await handleQuestionRoutes(request, env, url.pathname);
      if (questionResponse) return cors(questionResponse);

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

- [ ] **Step 7: Run all worker tests and verify they pass**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npx vitest run
```

Expected: All tests pass (auth + middleware + new routes)

- [ ] **Step 8: Commit**

```bash
git add src/worker/routes/families.ts src/worker/routes/visits.ts src/worker/routes/questions.ts src/worker/index.ts tests/worker/routes/families.test.ts tests/worker/routes/visits.test.ts tests/worker/routes/questions.test.ts
git commit -m "feat: family, visit, and question API routes"
```

---

### Task 2: React + Vite scaffold

**Files:**
- Modify: `package.json`
- Create: `src/pwa/vite.config.ts`
- Create: `src/pwa/tsconfig.json`
- Create: `src/pwa/index.html`
- Create: `src/pwa/public/manifest.webmanifest`
- Create: `src/pwa/main.tsx`
- Create: `src/pwa/App.tsx`
- Create: `src/pwa/styles/global.css`
- Create: `vitest.pwa.config.ts`

**Interfaces:**
- Produces: `npm run pwa:dev` launches Vite on :5173 with `/api/*` proxied to :8787; `npm run pwa:build` outputs to `dist/pwa/`

- [ ] **Step 1: Update `package.json`**

Add to `dependencies`:
```json
"react": "^18.3.1",
"react-dom": "^18.3.1",
"react-router-dom": "^6.26.0"
```

Add to `devDependencies`:
```json
"@types/react": "^18.3.0",
"@types/react-dom": "^18.3.0",
"@vitejs/plugin-react": "^4.3.0",
"vite": "^5.4.0"
```

Add to `scripts`:
```json
"pwa:dev": "vite --config src/pwa/vite.config.ts",
"pwa:build": "vite build --config src/pwa/vite.config.ts"
```

- [ ] **Step 2: Install dependencies**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npm install
```

Expected: node_modules updated, no errors

- [ ] **Step 3: Create `src/pwa/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/pwa',
  publicDir: 'public',
  build: {
    outDir: '../../dist/pwa',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
```

- [ ] **Step 4: Create `src/pwa/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"]
  },
  "include": ["**/*.ts", "**/*.tsx"]
}
```

- [ ] **Step 5: Create `src/pwa/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#121212" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>Food Line Check-In</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `src/pwa/public/manifest.webmanifest`**

```json
{
  "name": "Food Line Check-In",
  "short_name": "FoodLine",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#121212",
  "theme_color": "#121212",
  "icons": []
}
```

- [ ] **Step 7: Create `src/pwa/styles/global.css`**

```css
:root {
  --bg: #121212;
  --surface: #1e1e1e;
  --surface-2: #2a2a2a;
  --border: #3a3a3a;
  --text: #f4f4f4;
  --text-muted: #999;
  --accent: #f5a623;
  --accent-dark: #c47a00;
  --danger: #e55252;
  --success: #4caf50;
  --radius: 10px;
  --touch: 48px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 16px;
  line-height: 1.5;
  min-height: 100dvh;
}

button {
  min-height: var(--touch);
  border: none;
  border-radius: var(--radius);
  font-size: 16px;
  cursor: pointer;
  padding: 12px 20px;
  touch-action: manipulation;
}

.btn-primary { background: var(--accent); color: #000; font-weight: 700; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { background: var(--surface-2); color: var(--text); border: 1px solid var(--border); }
.btn-ghost { background: transparent; color: var(--text-muted); min-height: unset; padding: 8px 12px; }
.btn-large { font-size: 20px; padding: 16px 28px; width: 100%; }

.btn-tap {
  background: var(--surface-2);
  color: var(--text);
  border: 2px solid var(--border);
  font-size: 24px;
  font-weight: 700;
  min-width: var(--touch);
  min-height: var(--touch);
}
.btn-tap:active { background: var(--accent); color: #000; border-color: var(--accent); }

.btn-option {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 100%;
  text-align: left;
  padding: 16px;
  font-size: 18px;
  min-height: var(--touch);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.btn-option:active { border-color: var(--accent); }

input, select, textarea {
  min-height: var(--touch);
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 16px;
  padding: 12px;
  width: 100%;
}
input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 2px; }

label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: var(--text-muted); }

.error { color: var(--danger); font-size: 14px; margin-top: 8px; }
.error.banner {
  background: rgba(229, 82, 82, 0.15);
  border: 1px solid var(--danger);
  border-radius: var(--radius);
  padding: 12px;
  margin-bottom: 16px;
}

.question-en { font-size: 22px; font-weight: 600; line-height: 1.3; margin-bottom: 8px; }
.question-es { font-size: 22px; line-height: 1.3; color: var(--text-muted); margin-bottom: 24px; }

.wizard-step { display: flex; flex-direction: column; gap: 16px; padding: 16px; }
.step-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.option-list { display: flex; flex-direction: column; gap: 8px; }
.tap-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }

.progress-bar { height: 4px; background: var(--surface-2); border-radius: 2px; margin-top: 8px; }
.progress-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.2s; }

.wizard-header { padding: 12px 16px 0; }
.wizard-progress { font-size: 13px; color: var(--text-muted); }

.layout { display: flex; flex-direction: column; min-height: 100dvh; }
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.header-name { font-weight: 600; }
.main { flex: 1; padding: 16px; max-width: 600px; margin: 0 auto; width: 100%; }

.auth-page { padding: 32px 16px; max-width: 400px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
.auth-page h1 { font-size: 24px; }
.auth-form { display: flex; flex-direction: column; gap: 16px; }

.home-page { display: flex; flex-direction: column; gap: 16px; padding: 16px 0; }
.home-buttons { display: flex; flex-direction: column; gap: 12px; }

.lookup-form { display: flex; flex-direction: column; gap: 16px; }
.lookup-form h2 { font-size: 20px; }

.results-list { display: flex; flex-direction: column; gap: 8px; }
.result-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  text-align: left;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.result-name { font-size: 18px; font-weight: 600; }
.result-meta { font-size: 14px; color: var(--text-muted); }

.family-select { display: flex; flex-direction: column; gap: 12px; }
.family-card {
  background: var(--surface);
  border: 2px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  text-align: left;
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px;
}
.family-card.selected { border-color: var(--accent); }
.family-label { font-size: 12px; color: var(--text-muted); grid-column: 1; }
.family-name { font-size: 18px; font-weight: 600; grid-column: 1; }
.family-meta { font-size: 14px; color: var(--text-muted); grid-column: 1; }
.checkbox { font-size: 24px; grid-column: 2; grid-row: 1 / 4; align-self: center; }
.selection-count { font-size: 14px; color: var(--text-muted); }

.log-visit { display: flex; flex-direction: column; gap: 16px; }
.family-info-card { background: var(--surface); border-radius: var(--radius); padding: 16px; }
.family-info-card h2 { font-size: 22px; margin-bottom: 8px; }
.log-actions { display: flex; flex-direction: column; gap: 12px; }
.progress-label { font-size: 13px; color: var(--text-muted); }

.how-many { display: flex; flex-direction: column; gap: 24px; }
.proxy-question { display: flex; flex-direction: column; gap: 16px; }
.opt-detail { font-size: 14px; color: var(--text-muted); }

.enter-page { display: flex; flex-direction: column; gap: 0; }
.enter-page.done { align-items: center; justify-content: center; min-height: 60vh; gap: 24px; text-align: center; }
.enter-page.done h2 { font-size: 32px; }

.amount-input { display: flex; align-items: center; gap: 8px; }
.currency { font-size: 24px; font-weight: 700; }
.amount-input input { font-size: 24px; }
.sub-question { font-size: 16px; color: var(--text-muted); margin-bottom: 8px; }
```

- [ ] **Step 8: Create `src/pwa/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/global.css';
import App from './App';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 9: Create `src/pwa/App.tsx`** (placeholder routes — filled by later tasks)

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { getToken } from './store/auth';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import VerifyPage from './pages/VerifyPage';
import HomePage from './pages/HomePage';
import EnterPage from './pages/EnterPage';

function ProtectedLayout() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/enter" element={<EnterPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 10: Create `vitest.pwa.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/pwa/**/*.test.ts'],
  },
});
```

Add to `package.json` scripts:
```json
"test:pwa": "vitest run --config vitest.pwa.config.ts"
```

- [ ] **Step 11: Verify dev server starts**

In one terminal: `export PATH="/opt/homebrew/bin:$PATH" && npm run dev`
In another: `export PATH="/opt/homebrew/bin:$PATH" && npm run pwa:dev`

Open `http://localhost:5173` — expect a blank page with no console errors (App.tsx renders, redirects to /login, LoginPage doesn't exist yet).

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json src/pwa/ vitest.pwa.config.ts
git commit -m "feat: React + Vite PWA scaffold"
```

---

### Task 3: Auth store + auth pages

**Files:**
- Create: `src/pwa/store/auth.ts`
- Create: `src/pwa/pages/LoginPage.tsx`
- Create: `src/pwa/pages/RegisterPage.tsx`
- Create: `src/pwa/pages/VerifyPage.tsx`

**Interfaces:**
- Produces: `getToken(): string | null`, `getUser(): AuthUser | null`, `setAuth(token, user)`, `clearAuth()` from `src/pwa/store/auth.ts`
- Produces: LoginPage at `/login`, RegisterPage at `/register`, VerifyPage at `/verify`

- [ ] **Step 1: Create `src/pwa/store/auth.ts`**

```typescript
export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  role: 'admin' | 'staff' | 'volunteer';
}

interface AuthState {
  token: string;
  user: AuthUser;
}

const KEY = 'foodapp_auth';

export function getAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthState) : null;
  } catch {
    return null;
  }
}

export function setAuth(token: string, user: AuthUser): void {
  localStorage.setItem(KEY, JSON.stringify({ token, user }));
}

export function clearAuth(): void {
  localStorage.removeItem(KEY);
}

export function getToken(): string | null {
  return getAuth()?.token ?? null;
}

export function getUser(): AuthUser | null {
  return getAuth()?.user ?? null;
}
```

- [ ] **Step 2: Create `src/pwa/pages/LoginPage.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function LoginPage() {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json<{ error?: string }>();
      if (!res.ok) { setError(data.error ?? 'Login failed'); return; }
      navigate('/verify', { state: { phone } });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>Sign In / Iniciar sesión</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Phone / Número de teléfono
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            required
            autoComplete="tel"
            autoFocus
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary btn-large" disabled={loading || !phone}>
          {loading ? 'Sending... / Enviando...' : 'Send code / Enviar código'}
        </button>
      </form>
      <p>No account? <Link to="/register">Create one / Crear cuenta</Link></p>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/pwa/pages/RegisterPage.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone }),
      });
      const data = await res.json<{ error?: string }>();
      if (!res.ok) { setError(data.error ?? 'Registration failed'); return; }
      navigate('/verify', { state: { phone } });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>Create Account / Crear cuenta</h1>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Full name / Nombre completo
          <input type="text" value={name} onChange={e => setName(e.target.value)} required autoFocus />
        </label>
        <label>
          Phone / Número de teléfono
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} required autoComplete="tel" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary btn-large" disabled={loading || !name || !phone}>
          {loading ? 'Creating... / Creando...' : 'Create account / Crear cuenta'}
        </button>
      </form>
      <p>Already have an account? <Link to="/login">Sign in / Iniciar sesión</Link></p>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/pwa/pages/VerifyPage.tsx`**

```tsx
import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { setAuth } from '../store/auth';

export default function VerifyPage() {
  const location = useLocation();
  const phone = (location.state as { phone?: string })?.phone ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      const data = await res.json<{
        error?: string;
        token?: string;
        user?: { id: string; name: string; phone: string; role: 'admin' | 'staff' | 'volunteer' };
      }>();
      if (!res.ok) { setError(data.error ?? 'Verification failed'); return; }
      setAuth(data.token!, data.user!);
      navigate('/');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <h1>Enter code / Ingresar código</h1>
      <p>Code sent to {phone || 'your phone'}</p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          6-digit code / Código de 6 dígitos
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            required
            autoFocus
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary btn-large" disabled={loading || code.length < 6}>
          {loading ? 'Verifying... / Verificando...' : 'Verify / Verificar'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Test auth pages manually**

Start both servers. Navigate to `http://localhost:5173/login`. Try submitting with and without a phone number. Verify redirect to /verify. (Full OTP flow requires Worker running with real Twilio or ENVIRONMENT=test + manual OTP lookup in D1.)

- [ ] **Step 6: Commit**

```bash
git add src/pwa/store/auth.ts src/pwa/pages/LoginPage.tsx src/pwa/pages/RegisterPage.tsx src/pwa/pages/VerifyPage.tsx
git commit -m "feat: PWA auth store and login/register/verify pages"
```

---

### Task 4: Layout + Home screen

**Files:**
- Create: `src/pwa/components/Layout.tsx`
- Create: `src/pwa/pages/HomePage.tsx`

**Interfaces:**
- Consumes: `getUser()`, `clearAuth()` from `src/pwa/store/auth.ts`
- Produces: `<Layout />` (renders `<Outlet />`), `<HomePage />`

- [ ] **Step 1: Create `src/pwa/components/Layout.tsx`**

```tsx
import { Outlet, useNavigate } from 'react-router-dom';
import { getUser, clearAuth } from '../store/auth';

export default function Layout() {
  const navigate = useNavigate();
  const user = getUser()!;

  async function handleLogout() {
    try {
      const token = (await import('../store/auth')).getToken();
      await fetch('/api/auth/logout', {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch { /* ignore network errors on logout */ }
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="layout">
      <header className="header">
        <span className="header-name">{user.name}</span>
        <button className="btn-ghost" onClick={handleLogout}>Sign out</button>
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/pwa/pages/HomePage.tsx`**

```tsx
import { useNavigate } from 'react-router-dom';
import { getUser } from '../store/auth';

export default function HomePage() {
  const navigate = useNavigate();
  const user = getUser()!;

  return (
    <div className="home-page">
      <h1>Welcome, {user.name}</h1>
      <div className="home-buttons">
        <button className="btn-primary btn-large" onClick={() => navigate('/enter')}>
          Enter Data / Ingresar datos
        </button>
        {(user.role === 'staff' || user.role === 'admin') && (
          <button className="btn-secondary btn-large" disabled>
            View Records / Ver registros (coming soon)
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Test manually**

Log in through the auth flow. Verify: header shows name, "Sign out" works, volunteer sees only "Enter Data," staff/admin see both buttons.

- [ ] **Step 4: Commit**

```bash
git add src/pwa/components/Layout.tsx src/pwa/pages/HomePage.tsx
git commit -m "feat: Layout and Home screen"
```

---

### Task 5: Client utilities — ami.ts, api.ts, offline.ts

**Files:**
- Create: `src/pwa/lib/types.ts`
- Create: `src/pwa/lib/ami.ts`
- Create: `src/pwa/lib/api.ts`
- Create: `src/pwa/lib/offline.ts`
- Create: `tests/pwa/ami.test.ts`

**Interfaces:**
- Produces: `calcAmiBracket(amount, period, familySize): AmiBracket`, `getAmi(familySize): number` from `ami.ts`
- Produces: `api.get<T>(path)`, `api.post<T>(path, body)`, `api.patch<T>(path, body)`, `ApiError` from `api.ts`
- Produces: `queueItem(item)`, `getPending()`, `removeItem(id)` from `offline.ts`
- Produces: shared `WizardFormData`, `ProxyData`, `FamilySearchResult` types from `types.ts`

- [ ] **Step 1: Write failing ami tests**

```typescript
// tests/pwa/ami.test.ts
import { describe, it, expect } from 'vitest';
import { calcAmiBracket, getAmi } from '../../src/pwa/lib/ami';

describe('getAmi', () => {
  it('returns correct AMI for family of 1', () => {
    expect(getAmi(1)).toBe(59347);
  });
  it('returns correct AMI for family of 4', () => {
    expect(getAmi(4)).toBe(125621);
  });
  it('clamps at 7 for large families', () => {
    expect(getAmi(8)).toBe(127820);
    expect(getAmi(10)).toBe(127820);
  });
});

describe('calcAmiBracket', () => {
  it('weekly $700 for family of 4 → <30%', () => {
    // $700 × 52 = $36,400; AMI(4) = $125,621; ratio = 28.97%
    expect(calcAmiBracket(700, 'weekly', 4)).toBe('<30%');
  });
  it('monthly $3000 for family of 2 → 30-50%', () => {
    // $3,000 × 12 = $36,000; AMI(2) = $94,640; ratio = 38.04%
    expect(calcAmiBracket(3000, 'monthly', 2)).toBe('30-50%');
  });
  it('biweekly $1500 for family of 1 → 50-80%', () => {
    // $1,500 × 26 = $39,000; AMI(1) = $59,347; ratio = 65.73%
    expect(calcAmiBracket(1500, 'biweekly', 1)).toBe('50-80%');
  });
  it('yearly $100000 for family of 2 → 80-120%', () => {
    // $100,000; AMI(2) = $94,640; ratio = 105.66%
    expect(calcAmiBracket(100000, 'yearly', 2)).toBe('80-120%');
  });
  it('yearly $200000 for family of 4 → >120%', () => {
    // $200,000; AMI(4) = $125,621; ratio = 159.21%
    expect(calcAmiBracket(200000, 'yearly', 4)).toBe('>120%');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npx vitest run --config vitest.pwa.config.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/pwa/lib/types.ts`**

```typescript
export type UserRole = 'admin' | 'staff' | 'volunteer';
export type YesNoDeclined = 'yes' | 'no' | 'declined';
export type AmiBracket = '<30%' | '30-50%' | '50-80%' | '80-120%' | '>120%' | 'declined';

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

export interface FamilySearchResult extends Family {
  last_visit_date: string | null;
}

export interface WizardFormData {
  name: string;
  phone: string | null;
  zip_code: string | null;
  language: string | null;
  num_people: number | null;
  num_children_under_18: number | null;
  num_children_under_5: number | null;
  ami_bracket: AmiBracket | null;
  snap_benefits: YesNoDeclined | null;
  health_insurance: YesNoDeclined | null;
  receives_texts: boolean | null;
  want_text_updates: boolean | null;
}

export interface ProxyData {
  proxy_name: string;
  proxy_phone: string | null;
}
```

- [ ] **Step 4: Create `src/pwa/lib/ami.ts`**

```typescript
import type { AmiBracket } from './types';

export type PayPeriod = 'weekly' | 'biweekly' | 'monthly' | 'yearly';

const MULTIPLIERS: Record<PayPeriod, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  yearly: 1,
};

const AMI_BY_SIZE: Record<number, number> = {
  1: 59347,
  2: 94640,
  3: 115062,
  4: 125621,
  5: 121268,
  6: 132321,
  7: 127820,
};

export function getAmi(familySize: number): number {
  return AMI_BY_SIZE[Math.min(familySize, 7)];
}

export function calcAmiBracket(
  amount: number,
  period: PayPeriod,
  familySize: number
): AmiBracket {
  const annual = amount * MULTIPLIERS[period];
  const pct = annual / getAmi(familySize);
  if (pct < 0.3) return '<30%';
  if (pct < 0.5) return '30-50%';
  if (pct < 0.8) return '50-80%';
  if (pct < 1.2) return '80-120%';
  return '>120%';
}
```

- [ ] **Step 5: Run ami tests — verify they pass**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npx vitest run --config vitest.pwa.config.ts
```

Expected: 8/8 pass

- [ ] **Step 6: Create `src/pwa/lib/api.ts`**

```typescript
import { getToken } from '../store/auth';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json<{ error?: string }>().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return res.json<T>();
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
};
```

- [ ] **Step 7: Create `src/pwa/lib/offline.ts`**

```typescript
const DB_NAME = 'foodapp_offline';
const STORE = 'pending';

interface PendingItem {
  id: string;
  type: 'family' | 'visit';
  payload: unknown;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueItem(item: Pick<PendingItem, 'type' | 'payload'>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ ...item, id: crypto.randomUUID(), createdAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPending(): Promise<PendingItem[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as PendingItem[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeItem(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
```

- [ ] **Step 8: Commit**

```bash
git add src/pwa/lib/ tests/pwa/ vitest.pwa.config.ts package.json
git commit -m "feat: client utilities ami, api, offline + ami unit tests"
```

---

### Task 6: Lookup screen

**Files:**
- Create: `src/pwa/components/enter/LookupForm.tsx`

**Interfaces:**
- Produces: `<LookupForm onSearch={(name, phone) => void} />`
- `onSearch` is called by EnterPage (Task 10) to trigger the API search

- [ ] **Step 1: Create `src/pwa/components/enter/LookupForm.tsx`**

```tsx
import { useState } from 'react';

interface LookupFormProps {
  onSearch: (name: string, phone: string | null) => Promise<void>;
}

export default function LookupForm({ onSearch }: LookupFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const canSearch = name.trim().length > 0 || phone.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSearch) return;
    setLoading(true);
    try {
      await onSearch(name.trim(), phone.trim() || null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="lookup-form" onSubmit={handleSubmit}>
      <h2>Who is picking up today? / ¿Quién está recogiendo hoy?</h2>
      <label>
        Name / Nombre
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          autoComplete="off"
          autoFocus
        />
      </label>
      <label>
        Phone / Teléfono
        <input
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          autoComplete="off"
        />
      </label>
      <button
        type="submit"
        className="btn-primary btn-large"
        disabled={loading || !canSearch}
      >
        {loading ? 'Searching... / Buscando...' : 'Search / Buscar'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pwa/components/enter/LookupForm.tsx
git commit -m "feat: LookupForm component"
```

---

### Task 7: Returning family path

**Files:**
- Create: `src/pwa/components/enter/ResultsList.tsx`
- Create: `src/pwa/components/enter/FamilySelectScreen.tsx`
- Create: `src/pwa/components/enter/LogVisitScreen.tsx`

**Interfaces:**
- Consumes: `FamilySearchResult` from `src/pwa/lib/types.ts`
- Produces: `<ResultsList results onSelect onRegisterNew onBack />`
- Produces: `<FamilySelectScreen own proxy onConfirm onBack />`
- Produces: `<LogVisitScreen family total current onLogVisit />`

- [ ] **Step 1: Create `src/pwa/components/enter/ResultsList.tsx`**

```tsx
import type { FamilySearchResult } from '../../lib/types';

interface ResultsListProps {
  results: FamilySearchResult[];
  onSelect: (result: FamilySearchResult) => void;
  onRegisterNew: () => void;
  onBack: () => void;
}

export default function ResultsList({ results, onSelect, onRegisterNew, onBack }: ResultsListProps) {
  return (
    <div className="results-list">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <h2>Results / Resultados ({results.length})</h2>
      </div>
      {results.map(r => (
        <button key={r.id} className="result-card" onClick={() => onSelect(r)}>
          <span className="result-name">{r.name}</span>
          <span className="result-meta">
            {r.phone ? `···${r.phone.slice(-4)}` : 'No phone'}
            {' · '}
            {r.num_people ?? '?'} people
            {r.last_visit_date
              ? ` · Last visit: ${r.last_visit_date}`
              : ' · First visit'}
          </span>
        </button>
      ))}
      <button className="btn-secondary btn-large" style={{ marginTop: 8 }} onClick={onRegisterNew}>
        Not the right person → Register as new
        {' / '}
        No es la persona → Registrar como nuevo
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/pwa/components/enter/FamilySelectScreen.tsx`**

```tsx
import { useState } from 'react';
import type { FamilySearchResult } from '../../lib/types';

interface FamilySelectScreenProps {
  own: FamilySearchResult | null;
  proxy: FamilySearchResult[];
  onConfirm: (selected: FamilySearchResult[]) => void;
  onBack: () => void;
}

export default function FamilySelectScreen({ own, proxy, onConfirm, onBack }: FamilySelectScreenProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const all = [
    ...(own ? [{ family: own, label: 'Their own family / Su propia familia' }] : []),
    ...proxy.map(f => ({ family: f, label: 'Also picking up for / También recogiendo para' })),
  ];

  function handleConfirm() {
    onConfirm(all.filter(({ family }) => selected.has(family.id)).map(({ family }) => family));
  }

  return (
    <div className="family-select">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <h2>Select families / Seleccionar familias</h2>
      </div>
      <p className="selection-count">{selected.size} selected / seleccionadas</p>
      {all.map(({ family, label }) => (
        <button
          key={family.id}
          className={`family-card${selected.has(family.id) ? ' selected' : ''}`}
          onClick={() => toggle(family.id)}
        >
          <span className="family-label">{label}</span>
          <span className="family-name">{family.name}</span>
          <span className="family-meta">
            {family.num_people ?? '?'} people
            {family.last_visit_date ? ` · Last: ${family.last_visit_date}` : ''}
          </span>
          <span className="checkbox">{selected.has(family.id) ? '☑' : '☐'}</span>
        </button>
      ))}
      <button
        className="btn-primary btn-large"
        onClick={handleConfirm}
        disabled={selected.size === 0}
      >
        Confirm / Confirmar ({selected.size})
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/pwa/components/enter/LogVisitScreen.tsx`**

```tsx
import { useState } from 'react';
import type { FamilySearchResult } from '../../lib/types';

interface LogVisitScreenProps {
  family: FamilySearchResult;
  total: number;
  current: number;
  onLogVisit: (familyId: string) => Promise<void>;
}

export default function LogVisitScreen({ family, total, current, onLogVisit }: LogVisitScreenProps) {
  const [loading, setLoading] = useState(false);

  async function handleNoChange() {
    setLoading(true);
    await onLogVisit(family.id);
    setLoading(false);
  }

  return (
    <div className="log-visit">
      <p className="progress-label">Family {current + 1} of {total}</p>
      <div className="family-info-card">
        <h2>{family.name}</h2>
        {family.num_people && <p>{family.num_people} people in household</p>}
        {family.last_visit_date && <p>Last visit: {family.last_visit_date}</p>}
        {!family.last_visit_date && <p>First visit today</p>}
      </div>
      <div className="log-actions">
        <button className="btn-primary btn-large" onClick={handleNoChange} disabled={loading}>
          {loading ? 'Saving...' : 'No change / Sin cambios'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/pwa/components/enter/ResultsList.tsx src/pwa/components/enter/FamilySelectScreen.tsx src/pwa/components/enter/LogVisitScreen.tsx
git commit -m "feat: returning family path components"
```

---

### Task 8: New family flow — HowManyFamilies + ProxyQuestion

**Files:**
- Create: `src/pwa/components/enter/HowManyFamilies.tsx`
- Create: `src/pwa/components/enter/ProxyQuestion.tsx`

**Interfaces:**
- Produces: `<HowManyFamilies onSelect={(count: number) => void} />`
- Produces: `<ProxyQuestion prefillName prefillPhone onAnswer onBack />`; `onAnswer(proxy: ProxyData | null)`

- [ ] **Step 1: Create `src/pwa/components/enter/HowManyFamilies.tsx`**

```tsx
interface HowManyFamiliesProps {
  onSelect: (count: number) => void;
  onBack: () => void;
}

export default function HowManyFamilies({ onSelect, onBack }: HowManyFamiliesProps) {
  return (
    <div className="how-many">
      <button className="btn-ghost" onClick={onBack}>← Back</button>
      <p className="question-en">How many families are you picking up for today?</p>
      <p className="question-es">¿Para cuántas familias está recogiendo hoy?</p>
      <div className="tap-grid">
        {[1, 2, 3].map(n => (
          <button key={n} className="btn-tap" style={{ fontSize: 32, padding: '24px 0' }} onClick={() => onSelect(n)}>
            {n}
          </button>
        ))}
        <button className="btn-tap" style={{ fontSize: 32, padding: '24px 0' }} onClick={() => onSelect(4)}>
          4+
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/pwa/components/enter/ProxyQuestion.tsx`**

```tsx
import { useState } from 'react';
import type { ProxyData } from '../../lib/types';

interface ProxyQuestionProps {
  prefillName: string;
  prefillPhone: string | null;
  onAnswer: (proxy: ProxyData | null) => void;
  onBack: () => void;
}

export default function ProxyQuestion({ prefillName, prefillPhone, onAnswer, onBack }: ProxyQuestionProps) {
  const [showOther, setShowOther] = useState(false);
  const [otherName, setOtherName] = useState('');
  const [otherPhone, setOtherPhone] = useState('');

  if (showOther) {
    return (
      <div className="proxy-question">
        <button className="btn-ghost" onClick={() => setShowOther(false)}>← Back</button>
        <p className="question-en">Who is the designated pickup person?</p>
        <p className="question-es">¿Quién es la persona designada para recoger?</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label>
            Name / Nombre
            <input type="text" value={otherName} onChange={e => setOtherName(e.target.value)} autoFocus />
          </label>
          <label>
            Phone (optional) / Teléfono (opcional)
            <input type="tel" value={otherPhone} onChange={e => setOtherPhone(e.target.value)} />
          </label>
        </div>
        <div className="step-actions">
          <button
            className="btn-primary"
            onClick={() => onAnswer({ proxy_name: otherName, proxy_phone: otherPhone || null })}
            disabled={!otherName.trim()}
          >
            Next / Siguiente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="proxy-question">
      <button className="btn-ghost" onClick={onBack}>← Back</button>
      <p className="question-en">Who usually picks up food for this family?</p>
      <p className="question-es">¿Quién usualmente recoge los alimentos para esta familia?</p>
      <div className="option-list">
        <button
          className="btn-option"
          onClick={() => onAnswer({ proxy_name: prefillName, proxy_phone: prefillPhone })}
        >
          <span>The person here today / La persona aquí hoy</span>
          <span className="opt-detail">{prefillName}</span>
        </button>
        <button className="btn-option" onClick={() => setShowOther(true)}>
          Someone else / Otra persona
        </button>
        <button className="btn-option" onClick={() => onAnswer(null)}>
          No designated person / Sin persona designada
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pwa/components/enter/HowManyFamilies.tsx src/pwa/components/enter/ProxyQuestion.tsx
git commit -m "feat: HowManyFamilies and ProxyQuestion components"
```

---

### Task 9: Registration Wizard

**Files:**
- Create: `src/pwa/components/wizard/inputs/TextInput.tsx`
- Create: `src/pwa/components/wizard/inputs/PhoneInput.tsx`
- Create: `src/pwa/components/wizard/inputs/NumberInput.tsx`
- Create: `src/pwa/components/wizard/inputs/SelectInput.tsx`
- Create: `src/pwa/components/wizard/inputs/IncomeInput.tsx`
- Create: `src/pwa/components/wizard/Wizard.tsx`

**Interfaces:**
- Consumes: `calcAmiBracket`, `PayPeriod` from `src/pwa/lib/ami.ts`; `WizardFormData`, `ProxyData`, `AmiBracket`, `YesNoDeclined` from `src/pwa/lib/types.ts`
- Produces: `<Wizard familyIndex total initialData proxyData onComplete onBack />`; `onComplete(data: WizardFormData, proxy: ProxyData | null) => Promise<void>`

Wizard steps (hard-coded for Plan 3):
| Step | Field | Input |
|------|-------|-------|
| 0 | name | TextInput (required) |
| 1 | phone | PhoneInput (skip = null) |
| 2 | zip_code | TextInput, inputMode numeric |
| 3 | language | SelectInput (en/es/other/declined) |
| 4 | num_people | NumberInput, options 1-6, overflow 7+ |
| 5 | num_children_under_18 | NumberInput, options 0-5, overflow 6+ |
| 6 | num_children_under_5 | NumberInput, options 0-4, overflow 5+ |
| 7 | ami_bracket | IncomeInput |
| 8 | snap_benefits | SelectInput (yes/no/declined) |
| 9 | health_insurance | SelectInput (yes/no/declined) |
| 10 | receives_texts / want_text_updates | TextsStep (inline in Wizard) |

- [ ] **Step 1: Create `src/pwa/components/wizard/inputs/TextInput.tsx`**

```tsx
interface TextInputProps {
  questionEn: string;
  questionEs: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip?: () => void;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

export default function TextInput({
  questionEn, questionEs, value, onChange, onNext, onBack, onSkip, required, inputMode = 'text',
}: TextInputProps) {
  return (
    <div className="wizard-step">
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus
      />
      <div className="step-actions">
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
        {onSkip && (
          <button className="btn-ghost" onClick={onSkip}>Skip / Omitir</button>
        )}
        <button
          className="btn-primary"
          onClick={onNext}
          disabled={required ? !value.trim() : false}
        >
          Next / Siguiente
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/pwa/components/wizard/inputs/PhoneInput.tsx`**

```tsx
interface PhoneInputProps {
  questionEn: string;
  questionEs: string;
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export default function PhoneInput({ questionEn, questionEs, value, onChange, onNext, onBack, onSkip }: PhoneInputProps) {
  return (
    <div className="wizard-step">
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <input
        type="tel"
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus
        placeholder="(555) 555-5555"
      />
      <div className="step-actions">
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
        <button className="btn-secondary" onClick={onSkip}>
          I don't have one / No tengo
        </button>
        <button className="btn-primary" onClick={onNext}>
          Next / Siguiente
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/pwa/components/wizard/inputs/NumberInput.tsx`**

```tsx
import { useState } from 'react';

interface NumberInputProps {
  questionEn: string;
  questionEs: string;
  onChange: (v: number) => void;
  onBack: () => void;
  options: number[];
  overflowLabel: string;
  overflowMin: number;
}

export default function NumberInput({
  questionEn, questionEs, onChange, onBack, options, overflowLabel, overflowMin,
}: NumberInputProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState('');

  if (showCustom) {
    const n = parseInt(custom);
    return (
      <div className="wizard-step">
        <p className="question-en">{questionEn}</p>
        <p className="question-es">{questionEs}</p>
        <input
          type="number"
          inputMode="numeric"
          min={overflowMin}
          value={custom}
          onChange={e => setCustom(e.target.value)}
          autoFocus
        />
        <div className="step-actions">
          <button className="btn-ghost" onClick={() => setShowCustom(false)}>Back / Atrás</button>
          <button
            className="btn-primary"
            onClick={() => { if (!isNaN(n) && n >= overflowMin) onChange(n); }}
            disabled={isNaN(n) || n < overflowMin}
          >
            Next / Siguiente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard-step">
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <div className="tap-grid">
        {options.map(n => (
          <button key={n} className="btn-tap" onClick={() => onChange(n)}>{n}</button>
        ))}
        <button className="btn-tap" onClick={() => setShowCustom(true)}>{overflowLabel}</button>
      </div>
      <div className="step-actions">
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `src/pwa/components/wizard/inputs/SelectInput.tsx`**

```tsx
interface Option {
  value: string;
  labelEn: string;
  labelEs: string;
}

interface SelectInputProps {
  questionEn: string;
  questionEs: string;
  onChange: (v: string) => void;
  onBack: () => void;
  options: Option[];
}

export default function SelectInput({ questionEn, questionEs, onChange, onBack, options }: SelectInputProps) {
  return (
    <div className="wizard-step">
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <div className="option-list">
        {options.map(opt => (
          <button key={opt.value} className="btn-option" onClick={() => onChange(opt.value)}>
            <span>{opt.labelEn}</span>
            <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>{opt.labelEs}</span>
          </button>
        ))}
      </div>
      <div className="step-actions" style={{ marginTop: 8 }}>
        <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create `src/pwa/components/wizard/inputs/IncomeInput.tsx`**

```tsx
import { useState } from 'react';
import { calcAmiBracket } from '../../../lib/ami';
import type { PayPeriod } from '../../../lib/ami';
import type { AmiBracket } from '../../../lib/types';

interface IncomeInputProps {
  questionEn: string;
  questionEs: string;
  familySize: number;
  onChange: (bracket: AmiBracket) => void;
  onBack: () => void;
  onSkip: () => void;
}

const PERIODS: { value: PayPeriod; labelEn: string }[] = [
  { value: 'weekly', labelEn: 'Weekly / Semanal' },
  { value: 'biweekly', labelEn: 'Every 2 weeks / Cada 2 semanas' },
  { value: 'monthly', labelEn: 'Monthly / Mensual' },
  { value: 'yearly', labelEn: 'Yearly / Anual' },
];

export default function IncomeInput({ questionEn, questionEs, familySize, onChange, onBack, onSkip }: IncomeInputProps) {
  const [period, setPeriod] = useState<PayPeriod | null>(null);
  const [amount, setAmount] = useState('');

  if (!period) {
    return (
      <div className="wizard-step">
        <p className="question-en">{questionEn}</p>
        <p className="question-es">{questionEs}</p>
        <p className="sub-question">How often do you get paid? / ¿Con qué frecuencia le pagan?</p>
        <div className="option-list">
          {PERIODS.map(p => (
            <button key={p.value} className="btn-option" onClick={() => setPeriod(p.value)}>
              {p.labelEn}
            </button>
          ))}
        </div>
        <div className="step-actions">
          <button className="btn-ghost" onClick={onBack}>Back / Atrás</button>
          <button className="btn-ghost" onClick={onSkip}>
            Prefer not to say / Prefiero no responder
          </button>
        </div>
      </div>
    );
  }

  const n = parseFloat(amount.replace(/[^0-9.]/g, ''));
  return (
    <div className="wizard-step">
      <p className="question-en">{questionEn}</p>
      <p className="question-es">{questionEs}</p>
      <p className="sub-question">About how much each time? / ¿Aproximadamente cuánto cada vez?</p>
      <div className="amount-input">
        <span className="currency">$</span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0"
          autoFocus
        />
      </div>
      <div className="step-actions">
        <button className="btn-ghost" onClick={() => setPeriod(null)}>Back / Atrás</button>
        <button className="btn-ghost" onClick={onSkip}>
          Prefer not to say / Prefiero no responder
        </button>
        <button
          className="btn-primary"
          onClick={() => { if (!isNaN(n) && n > 0) onChange(calcAmiBracket(n, period, familySize)); }}
          disabled={isNaN(n) || n <= 0}
        >
          Next / Siguiente
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `src/pwa/components/wizard/Wizard.tsx`**

```tsx
import { useState } from 'react';
import type { WizardFormData, ProxyData, YesNoDeclined } from '../../lib/types';
import TextInput from './inputs/TextInput';
import PhoneInput from './inputs/PhoneInput';
import NumberInput from './inputs/NumberInput';
import SelectInput from './inputs/SelectInput';
import IncomeInput from './inputs/IncomeInput';

const TOTAL_STEPS = 11;

const YES_NO_DECLINED = [
  { value: 'yes', labelEn: 'Yes / Sí', labelEs: 'Sí / Yes' },
  { value: 'no', labelEn: 'No / No', labelEs: 'No / No' },
  { value: 'declined', labelEn: 'Prefer not to say / Prefiero no responder', labelEs: 'Prefiero no responder' },
];

interface TextsStepProps {
  receivesTexts: boolean | null;
  onReceivesChange: (v: boolean | null) => void;
  onWantUpdatesChange: (v: boolean | null) => void;
  onComplete: () => void;
  onBack: () => void;
}

function TextsStep({ onReceivesChange, onWantUpdatesChange, onComplete, onBack }: TextsStepProps) {
  const [subStep, setSubStep] = useState(0);

  if (subStep === 0) {
    return (
      <div className="wizard-step">
        <p className="question-en">Do you currently receive text messages?</p>
        <p className="question-es">¿Actualmente recibe mensajes de texto?</p>
        <div className="option-list">
          <button className="btn-option" onClick={() => { onReceivesChange(true); setSubStep(1); }}>
            Yes / Sí
          </button>
          <button className="btn-option" onClick={() => { onReceivesChange(false); onWantUpdatesChange(null); onComplete(); }}>
            No / No
          </button>
          <button className="btn-option" onClick={() => { onReceivesChange(null); onWantUpdatesChange(null); onComplete(); }}>
            Prefer not to say / Prefiero no responder
          </button>
        </div>
        <div className="step-actions"><button className="btn-ghost" onClick={onBack}>Back / Atrás</button></div>
      </div>
    );
  }

  return (
    <div className="wizard-step">
      <p className="question-en">
        Would you like to receive text updates about food distribution events?
      </p>
      <p className="question-es">
        ¿Le gustaría recibir actualizaciones por mensaje de texto sobre eventos de distribución de alimentos?
      </p>
      <div className="option-list">
        <button className="btn-option" onClick={() => { onWantUpdatesChange(true); onComplete(); }}>
          Yes / Sí
        </button>
        <button className="btn-option" onClick={() => { onWantUpdatesChange(false); onComplete(); }}>
          No / No
        </button>
      </div>
      <div className="step-actions">
        <button className="btn-ghost" onClick={() => setSubStep(0)}>Back / Atrás</button>
      </div>
    </div>
  );
}

interface WizardProps {
  familyIndex: number;
  total: number;
  initialData: Partial<WizardFormData>;
  proxyData: ProxyData | null;
  onComplete: (data: WizardFormData, proxy: ProxyData | null) => Promise<void>;
  onBack: () => void;
}

export default function Wizard({ familyIndex, total, initialData, proxyData, onComplete, onBack }: WizardProps) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Partial<WizardFormData>>({ ...initialData });
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof WizardFormData>(key: K, value: WizardFormData[K]) {
    setData(prev => ({ ...prev, [key]: value }));
  }

  function next() { setStep(s => s + 1); }

  function goBack() {
    if (step === 0) onBack(); else setStep(s => s - 1);
  }

  async function finish(finalData: Partial<WizardFormData>) {
    setSubmitting(true);
    try {
      await onComplete(finalData as WizardFormData, proxyData);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wizard">
      <div className="wizard-header">
        <p className="wizard-progress">
          Family {familyIndex + 1} of {total} — Step {step + 1} of {TOTAL_STEPS}
        </p>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} />
        </div>
      </div>

      {step === 0 && (
        <TextInput
          questionEn="What is your full name?"
          questionEs="¿Cuál es su nombre completo?"
          value={data.name ?? ''}
          onChange={v => set('name', v)}
          onNext={next}
          onBack={goBack}
          required
        />
      )}
      {step === 1 && (
        <PhoneInput
          questionEn="What is your phone number?"
          questionEs="¿Cuál es su número de teléfono?"
          value={data.phone ?? ''}
          onChange={v => set('phone', v)}
          onNext={next}
          onBack={goBack}
          onSkip={() => { set('phone', null); next(); }}
        />
      )}
      {step === 2 && (
        <TextInput
          questionEn="What is your zip code?"
          questionEs="¿Cuál es su código postal?"
          value={data.zip_code ?? ''}
          onChange={v => set('zip_code', v)}
          onNext={next}
          onBack={goBack}
          onSkip={() => { set('zip_code', null); next(); }}
          inputMode="numeric"
        />
      )}
      {step === 3 && (
        <SelectInput
          questionEn="What language do you prefer?"
          questionEs="¿Qué idioma prefiere?"
          onChange={v => { set('language', v); next(); }}
          onBack={goBack}
          options={[
            { value: 'en', labelEn: 'English', labelEs: 'English' },
            { value: 'es', labelEn: 'Español', labelEs: 'Español' },
            { value: 'other', labelEn: 'Other / Otro', labelEs: 'Otro / Other' },
            { value: 'declined', labelEn: 'Prefer not to say / Prefiero no responder', labelEs: 'Prefiero no responder' },
          ]}
        />
      )}
      {step === 4 && (
        <NumberInput
          questionEn="How many people live in your household?"
          questionEs="¿Cuántas personas viven en su hogar?"
          onChange={v => { set('num_people', v); next(); }}
          onBack={goBack}
          options={[1, 2, 3, 4, 5, 6]}
          overflowLabel="7+"
          overflowMin={7}
        />
      )}
      {step === 5 && (
        <NumberInput
          questionEn="How many children under 18 live in your household?"
          questionEs="¿Cuántos niños menores de 18 años viven en su hogar?"
          onChange={v => { set('num_children_under_18', v); next(); }}
          onBack={goBack}
          options={[0, 1, 2, 3, 4, 5]}
          overflowLabel="6+"
          overflowMin={6}
        />
      )}
      {step === 6 && (
        <NumberInput
          questionEn="How many children under 5 live in your household?"
          questionEs="¿Cuántos niños menores de 5 años viven en su hogar?"
          onChange={v => { set('num_children_under_5', v); next(); }}
          onBack={goBack}
          options={[0, 1, 2, 3, 4]}
          overflowLabel="5+"
          overflowMin={5}
        />
      )}
      {step === 7 && (
        <IncomeInput
          questionEn="How often do you get paid? And about how much each time?"
          questionEs="¿Con qué frecuencia le pagan? ¿Y aproximadamente cuánto cada vez?"
          familySize={data.num_people ?? 1}
          onChange={v => { set('ami_bracket', v); next(); }}
          onBack={goBack}
          onSkip={() => { set('ami_bracket', 'declined'); next(); }}
        />
      )}
      {step === 8 && (
        <SelectInput
          questionEn="Does your family currently receive SNAP benefits?"
          questionEs="¿Su familia recibe beneficios de SNAP actualmente?"
          onChange={v => { set('snap_benefits', v as YesNoDeclined); next(); }}
          onBack={goBack}
          options={YES_NO_DECLINED}
        />
      )}
      {step === 9 && (
        <SelectInput
          questionEn="Does anyone in your family have health insurance?"
          questionEs="¿Alguien en su familia tiene seguro de salud?"
          onChange={v => { set('health_insurance', v as YesNoDeclined); next(); }}
          onBack={goBack}
          options={YES_NO_DECLINED}
        />
      )}
      {step === 10 && (
        <TextsStep
          receivesTexts={data.receives_texts ?? null}
          onReceivesChange={v => set('receives_texts', v)}
          onWantUpdatesChange={v => set('want_text_updates', v)}
          onComplete={() => { if (!submitting) finish(data); }}
          onBack={goBack}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Test wizard manually**

Run dev servers. Navigate to `/enter` (requires auth). Trigger the new family flow (search a non-existent name). Walk through all 11 wizard steps. Verify: back navigation, skip on phone/zip, income sub-steps, conditional text step 11b only shows when 11a = Yes.

- [ ] **Step 8: Commit**

```bash
git add src/pwa/components/wizard/
git commit -m "feat: 11-step registration wizard"
```

---

### Task 10: EnterPage orchestrator + Service Worker

**Files:**
- Create: `src/pwa/pages/EnterPage.tsx`
- Create: `src/pwa/public/sw.js`

**Interfaces:**
- Consumes: All enter/ and wizard/ components; `api`, `ApiError` from `lib/api.ts`; `queueItem` from `lib/offline.ts`; `getUser` from `store/auth.ts`
- Produces: complete `/enter` flow wired end-to-end; `/sw.js` cached offline app shell

- [ ] **Step 1: Create `src/pwa/pages/EnterPage.tsx`**

```tsx
import { useState } from 'react';
import type { FamilySearchResult, WizardFormData, ProxyData } from '../lib/types';
import { api, ApiError } from '../lib/api';
import { queueItem } from '../lib/offline';
import LookupForm from '../components/enter/LookupForm';
import ResultsList from '../components/enter/ResultsList';
import FamilySelectScreen from '../components/enter/FamilySelectScreen';
import LogVisitScreen from '../components/enter/LogVisitScreen';
import HowManyFamilies from '../components/enter/HowManyFamilies';
import ProxyQuestion from '../components/enter/ProxyQuestion';
import Wizard from '../components/wizard/Wizard';

type EnterView =
  | { type: 'lookup' }
  | { type: 'results'; results: FamilySearchResult[]; searchName: string; searchPhone: string | null }
  | { type: 'family-select'; own: FamilySearchResult | null; proxy: FamilySearchResult[] }
  | { type: 'log-visit'; families: FamilySearchResult[]; current: number }
  | { type: 'how-many'; searchName: string; searchPhone: string | null }
  | { type: 'proxy-question'; familyIndex: number; total: number; prefillName: string; prefillPhone: string | null }
  | { type: 'wizard'; familyIndex: number; total: number; initialData: Partial<WizardFormData>; proxyData: ProxyData | null }
  | { type: 'done' };

export default function EnterPage() {
  const [view, setView] = useState<EnterView>({ type: 'lookup' });
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(name: string, phone: string | null) {
    setError(null);
    try {
      // Phone-first: check for own family + proxy families
      if (phone) {
        const pickup = await api.get<{ own: FamilySearchResult | null; proxy: FamilySearchResult[] }>(
          `/api/families/pickup?phone=${encodeURIComponent(phone)}`
        );
        if (pickup.own || pickup.proxy.length > 0) {
          setView({ type: 'family-select', own: pickup.own, proxy: pickup.proxy });
          return;
        }
      }
      // Fall back to fuzzy name+phone search
      const params = new URLSearchParams();
      if (name) params.set('name', name);
      if (phone) params.set('phone', phone);
      const { results } = await api.get<{ results: FamilySearchResult[] }>(
        `/api/families/search?${params}`
      );
      if (results.length === 0) {
        setView({ type: 'how-many', searchName: name, searchPhone: phone });
      } else {
        setView({ type: 'results', results, searchName: name, searchPhone: phone });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Network error. Check connection and try again.');
    }
  }

  async function handleSelectResult(result: FamilySearchResult) {
    // Expand to include proxy families if we know their phone
    if (result.phone) {
      try {
        const pickup = await api.get<{ own: FamilySearchResult | null; proxy: FamilySearchResult[] }>(
          `/api/families/pickup?phone=${encodeURIComponent(result.phone)}`
        );
        setView({ type: 'family-select', own: pickup.own ?? result, proxy: pickup.proxy });
        return;
      } catch { /* fall through to single-family select */ }
    }
    setView({ type: 'family-select', own: result, proxy: [] });
  }

  function handleFamilySelectConfirm(families: FamilySearchResult[]) {
    if (families.length === 0) return;
    setView({ type: 'log-visit', families, current: 0 });
  }

  async function handleLogVisit(familyId: string) {
    if (view.type !== 'log-visit') return;
    const { families, current } = view;
    try {
      await api.post('/api/visits', {
        family_id: familyId,
        visit_date: new Date().toISOString().slice(0, 10),
      });
    } catch {
      await queueItem({ type: 'visit', payload: { family_id: familyId, visit_date: new Date().toISOString().slice(0, 10) } });
    }
    if (current + 1 < families.length) {
      setView({ type: 'log-visit', families, current: current + 1 });
    } else {
      setView({ type: 'done' });
    }
  }

  function handleHowMany(count: number) {
    if (view.type !== 'how-many') return;
    setView({
      type: 'proxy-question',
      familyIndex: 0,
      total: count,
      prefillName: view.searchName,
      prefillPhone: view.searchPhone,
    });
  }

  function handleProxyAnswer(proxyData: ProxyData | null) {
    if (view.type !== 'proxy-question') return;
    setView({
      type: 'wizard',
      familyIndex: view.familyIndex,
      total: view.total,
      initialData: { name: view.prefillName, phone: view.prefillPhone },
      proxyData,
    });
  }

  async function handleWizardComplete(data: WizardFormData, proxyData: ProxyData | null) {
    if (view.type !== 'wizard') return;
    const { familyIndex, total } = view;
    try {
      const { id } = await api.post<{ id: string }>('/api/families', {
        ...data,
        first_visit_date: new Date().toISOString().slice(0, 10),
        proxy: proxyData ?? undefined,
      });
      await api.post('/api/visits', {
        family_id: id,
        visit_date: new Date().toISOString().slice(0, 10),
        picked_up_by_phone: proxyData?.proxy_phone ?? null,
      });
    } catch {
      await queueItem({ type: 'family', payload: { data, proxyData } });
    }
    if (familyIndex + 1 < total) {
      setView({
        type: 'proxy-question',
        familyIndex: familyIndex + 1,
        total,
        prefillName: '',
        prefillPhone: null,
      });
    } else {
      setView({ type: 'done' });
    }
  }

  if (view.type === 'done') {
    return (
      <div className="enter-page done">
        <h2>Done / Listo ✓</h2>
        <p>Visit recorded / Visita registrada</p>
        <button className="btn-primary btn-large" onClick={() => setView({ type: 'lookup' })}>
          Next person / Siguiente persona
        </button>
      </div>
    );
  }

  return (
    <div className="enter-page">
      {error && <p className="error banner">{error}</p>}

      {view.type === 'lookup' && (
        <LookupForm onSearch={handleSearch} />
      )}
      {view.type === 'results' && (
        <ResultsList
          results={view.results}
          onSelect={handleSelectResult}
          onRegisterNew={() => {
            if (view.type === 'results') {
              setView({ type: 'how-many', searchName: view.searchName, searchPhone: view.searchPhone });
            }
          }}
          onBack={() => setView({ type: 'lookup' })}
        />
      )}
      {view.type === 'family-select' && (
        <FamilySelectScreen
          own={view.own}
          proxy={view.proxy}
          onConfirm={handleFamilySelectConfirm}
          onBack={() => setView({ type: 'lookup' })}
        />
      )}
      {view.type === 'log-visit' && (
        <LogVisitScreen
          family={view.families[view.current]}
          total={view.families.length}
          current={view.current}
          onLogVisit={handleLogVisit}
        />
      )}
      {view.type === 'how-many' && (
        <HowManyFamilies
          onSelect={handleHowMany}
          onBack={() => setView({ type: 'lookup' })}
        />
      )}
      {view.type === 'proxy-question' && (
        <ProxyQuestion
          prefillName={view.prefillName}
          prefillPhone={view.prefillPhone}
          onAnswer={handleProxyAnswer}
          onBack={() => {
            if (view.type === 'proxy-question') {
              setView({ type: 'how-many', searchName: view.prefillName, searchPhone: view.prefillPhone });
            }
          }}
        />
      )}
      {view.type === 'wizard' && (
        <Wizard
          familyIndex={view.familyIndex}
          total={view.total}
          initialData={view.initialData}
          proxyData={view.proxyData}
          onComplete={handleWizardComplete}
          onBack={() => {
            if (view.type === 'wizard') {
              setView({
                type: 'proxy-question',
                familyIndex: view.familyIndex,
                total: view.total,
                prefillName: view.initialData.name ?? '',
                prefillPhone: view.initialData.phone ?? null,
              });
            }
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/pwa/public/sw.js`**

```javascript
const CACHE = 'foodapp-v1';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.add('/')).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API calls: network only, never cache
  if (url.pathname.startsWith('/api/')) return;
  // Navigation: network first, fall back to cached index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match('/').then(r => r ?? fetch(e.request)))
    );
    return;
  }
  // Assets: cache first, populate on miss
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
    })
  );
});
```

- [ ] **Step 3: End-to-end test — golden path (new family)**

With both servers running:
1. Log in, navigate to `/enter`
2. Enter a name that doesn't exist → tap Search
3. Verify "How many families" screen appears
4. Tap 1 → Proxy question → tap "No designated person"
5. Walk all 11 wizard steps
6. Verify "Done / Listo" screen
7. Check D1: `wrangler d1 execute foodapp --local --command "SELECT * FROM families ORDER BY created_at DESC LIMIT 1;"`
8. Check visits: `wrangler d1 execute foodapp --local --command "SELECT * FROM visits ORDER BY created_at DESC LIMIT 1;"`

- [ ] **Step 4: End-to-end test — returning family**

1. Use the phone from the family created above
2. Enter same phone in lookup → should find the family via `/api/families/pickup`
3. Verify FamilySelect screen shows it
4. Check one family → Confirm → LogVisit screen
5. Tap "No change" → Done

- [ ] **Step 5: End-to-end test — offline queue**

1. Stop the Worker dev server (kill `npm run dev`)
2. Complete the new family flow again
3. Verify "Done" screen still appears (queued to IndexedDB)
4. Open DevTools → Application → IndexedDB → `foodapp_offline` → verify pending item

- [ ] **Step 6: Run all worker tests one final time**

```bash
export PATH="/opt/homebrew/bin:$PATH" && npx vitest run
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/pwa/pages/EnterPage.tsx src/pwa/public/sw.js
git commit -m "feat: EnterPage orchestrator and service worker — Plan 3 complete"
```
