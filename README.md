# foodbox-data-app

Check-in app for the Creighton Community Foundation hunger-relief food box line. Volunteers sign in with their phone number, look up or register families as cars come through, and record each visit and bag count. Built to keep working when the WiFi doesn't.

**Live (production):** https://foodbox-data-app.jeff-be7.workers.dev

## What the program does

A food distribution line moves fast: a volunteer with a tablet needs to answer "have we seen this family before?" in seconds, record the visit, and move to the next car. This app does exactly that, and it treats a dead network as a normal working condition rather than an outage:

- **Check-in**: search by name or phone, select the family (or the several families one pickup person is authorized to collect for), log the visit, record whether they took a reusable bag.
- **Registration**: new families go through a short bilingual wizard (household size, language, ZIP, benefits questions). All questions are skippable; the line keeps moving.
- **Offline**: entries queue on the device and sync when the network returns. A cached family directory means returning households are still findable during an outage instead of being re-registered as duplicates.
- **Admin**: import from the old Bubble system, review and merge duplicate families, view and edit records, manage volunteer accounts.

## Logic flow (the volunteer journey)

```
Sign in (phone + SMS code)
        |
        v
Enter Data: search name/phone ----------------------------+
        |                                                  |
   match found                                       no match / offline
        |                                                  |
        v                                                  v
Family-select (own family + any proxy-linked      "How many families?"
families for that phone, together)                 -> registration wizard
        |                                                  |
        v                                                  v
Log visit (records who picked up when it     Family + today's visit created
was a proxy phone)                           (or queued, if offline)
        |                                                  |
        +------------------------+-------------------------+
                                 v
                     Summary: bag picklist -> save
                                 |
                                 v
                            Next car
```

When any write fails for network reasons it is queued in IndexedDB with an idempotency key, and the app replays it when connectivity returns. Replays are safe to repeat: the server deduplicates on the key, and families that were merged in the meantime resolve to the surviving record.

## Architecture

One Cloudflare Worker serves both the API and the built PWA:

| Layer | Where | What it does |
|---|---|---|
| React PWA | `src/pwa/` | The volunteer/admin UI. Built with Vite; `@vitejs/plugin-legacy` keeps it running on the target iPad 2 (iOS 9.3.5). |
| Service worker | `src/pwa/public/sw.js` | Precaches the app shell so the app loads offline (on browsers that support SW; see offline tiers below). The build injects the asset list at the `PRECACHE_URLS` marker and fails loudly if the marker is missing. |
| Offline library | `src/pwa/lib/offline.ts` | The heart of offline-first: the IndexedDB pending queue, dead-letter store, flush/replay engine, and the cached family directory. |
| Worker API | `src/worker/` | Routes under `/api/*` (`run_worker_first` in `wrangler.jsonc` guarantees they hit the worker, never the SPA fallback). |
| Shared fuzzy matching | `src/shared/fuzzy.ts` | One implementation of Levenshtein matching, name normalization, and phone normalization used by BOTH the server search and the offline directory, so online and offline lookup can never drift apart. |
| Data | Cloudflare D1 (SQLite) + KV | D1 `foodapp` holds families, visits, proxies, users, audit trails, merge aliases. KV holds sessions and rate-limit counters. |

### Key modules

| File | Responsibility |
|---|---|
| `src/worker/routes/auth.ts` | Register/login with SMS one-time codes (Twilio), sessions, plus a test-only OTP endpoint that exists ONLY when `ENVIRONMENT=test`. |
| `src/worker/routes/families.ts` | Search, pickup lookup (own + proxy families), create, update, proxy authorization, and the `/directory` roster the PWA caches for offline lookup. |
| `src/worker/routes/visits.ts` | Visit creation (resolves merged-away family ids through aliases; genuinely gone families 404 so queued replays dead-letter instead of retrying forever), bag marking with audit rows. |
| `src/worker/routes/admin.ts` | Bubble import (idempotent on `bubble_id`), user management with last-admin protection. |
| `src/worker/duplicates.ts` | Duplicate detection and atomic family merges, including idempotency-key and family-id aliases so offline replays survive merges. |
| `src/worker/db.ts` | Data access: idempotent inserts, the full-scan tiered fuzzy search, boolean mapping for D1's 0/1 storage. |
| `src/pwa/pages/EnterPage.tsx` | The check-in flow: search, results, family-select, registration wizard, visit logging, summary. |
| `src/pwa/components/Layout.tsx` | The app chrome plus all the safety machinery: sync banners, dead-letter recovery, cross-tab account-change overlay, directory refresh triggers. |

### Identity integrity (worth understanding before touching sync code)

These devices are shared. A queued entry belongs to whoever typed it, and the code goes to real lengths to keep that true: every submission and every background flush pins ONE auth snapshot (token + user id read together) for its whole lifetime; queued items carry `queuedByUserId` and will not sync under a different signed-in account (they are held, with an explicit supervisor-recovery path); and a cross-tab account switch raises a blocking, focus-trapped overlay that preserves the in-progress draft rather than destroying or misattributing it.

### Offline support tiers

On browsers with service workers (Safari 11.1+/iOS 11.3+, modern Chrome/Edge/Firefox) the app also restarts offline. The iOS 9 target has no service worker, so offline there is active-tab-only: an open tab queues and syncs fine, but relaunching during an outage fails until the network returns. The app shows a persistent notice on such devices.

## Build and deploy pipeline

```
push to main
   |
   v
Cloudflare Workers Builds (git integration)
   npm run build   = vite build (modern + legacy bundles)
                     + node scripts/inject-precache.mjs (injects asset URLs
                       into sw.js; THROWS if the marker line is missing)
   npx wrangler deploy
   |
   v
production at foodbox-data-app.jeff-be7.workers.dev
```

- Every push to `main` deploys to production. Branch pushes get preview builds.
- GitHub Actions run in parallel as gates: `ci.yml` (typechecks + the four unit suites, with an enforced coverage floor on `src/pwa/lib`) and `e2e.yml` (the three Playwright journeys) on every PR and main push.
- If a Workers Build fails with a transient Cloudflare error (for example D1 binding error 10021, "try again later"), retry it from the dashboard build page, or via the Builds API: create a manual build on the trigger with `branch: "main"` (a short commit hash fails at clone; use the full hash or the branch).
- Manual deploy, rarely needed: `npm run deploy`.

## Test suites

Run the suite that matches what you touched:

| Command | What it covers | Where |
|---|---|---|
| `npm test` | Worker/API against real D1+KV emulation (vitest-pool-workers) | tests/worker/ |
| `npm run test:pwa` | Offline queue, directory cache, flush engine (fake-indexeddb) | tests/pwa/ |
| `npm run test:ui` | React components (Testing Library + jsdom) | tests/pwa-ui/ |
| `npm run test:scripts` | Build tooling (precache injector, backfill parity) | tests/scripts/ |
| `npm run test:e2e` | Three full journeys in Chromium against the real stack: online check-in, offline queue-and-sync, offline returning household | tests/e2e/ |

The e2e harness builds the app, applies migrations to local D1, and boots `wrangler dev` with `ENVIRONMENT=test`, which enables a test-only OTP-reading endpoint and relaxes the global (not per-phone) SMS rate caps. Neither exists in production, and there are tests proving it.

House rules for tests: offline queue changes require tests (replay is the core feature), and regression tests from past incidents are never deleted.

## Local development

```sh
npm install
npm run build        # build the PWA first; wrangler dev serves dist/pwa
npm run dev          # worker + PWA on :8787
npm run pwa:dev      # frontend-only hot reload
```

Apply local migrations before exercising API routes:

```sh
npx wrangler d1 migrations apply foodapp --local
```

If `/api/*` returns empty 404s under wrangler dev, delete `.wrangler/deploy/` (a stale generated config can redirect dev to a dead build output).

## Database migrations

Numbered files in `migrations/`, currently 0001 through 0009. Never edit an applied migration; add a new numbered file. Local/test environments apply them automatically where needed. Production applies are manual and deliberate:

```sh
npx wrangler d1 migrations apply foodapp --remote
```

Apply production migrations BEFORE merging code that depends on them, because merging deploys immediately.

`scripts/backfill-normalized.mjs` is a one-time idempotent backfill for `name_normalized` on rows imported before normalization existed (pass `--remote` for production; safe to re-run).

### `client_events` — client telemetry data contract

The check-in wizard runs entirely client-side with no network traffic between lookup and submit, so a crash or reload mid-entry was previously invisible. `migrations/0010_client_events.sql` adds a `client_events` table that the PWA POSTs to via `POST /api/client-events` (unauthenticated — a crashed or logged-out client must still be able to report). This table is the read contract for the planned admin console (issue #13); any schema change here must update this section in the same commit.

Columns, one fact each: `id` (client-minted UUID, the idempotency key — inserts use `INSERT OR IGNORE`), `received_at`/`occurred_at`, `user_id` (nullable), `session_id` (per page load), `device_id` (persisted per device), `seq` (intra-session ordering — not in the original issue #12 column list, added for ordering breadcrumbs across a flush), `level` (`error|warn|info`), `kind` (`js_error|unhandled_rejection|react_boundary|view_change|wizard_step|draft_restored|draft_discarded|sw_update|visibility|api_failure` — `view_change` is also an addition beyond issue #12's original enum, splitting "which screen" from "which wizard step" into two single-fact kinds), `route`, `wizard_step` (1-based, matching the UI's "Step N of 11"), `view_type`, `message`, `stack`, `user_agent`, `online`, `app_version`, `extra` (bounded JSON).

Caveats for a future consumer: events delivered via `navigator.sendBeacon` (page-unload) carry no `Authorization` header and are always unattributed (`user_id` is null) — session/device ids still correlate them to the rest of that session. Rows older than 30 days are purged by a daily cron (`scheduled` handler in `src/worker/index.ts`).

## Standing design decisions

- **No role gating for data sensitivity.** Food line data is not PII (explicit decision). Anyone can self-register as a volunteer; SMS rate limits are the abuse control. Do not re-add auth gates for this reason.
- **The offline directory caches the family roster on shared devices.** Same not-PII decision; SMS-gated auth is still required to fetch it.
- **Adopting another user's held queue entries is allowed** behind a deliberate two-click flow, because a deactivated owner must not strand data forever. Attribution accuracy is traded for the data, explicitly.
- **Merges never lose replay-ability.** Both idempotency keys and old family ids get aliases to the surviving record.

## Where to go next

- `AGENTS.md`: the short operating rules for AI-assisted sessions in this repo.
- `docs/whats-new-2026-08.md`: a plain-language summary of the August 2026 hardening work (start here if you are returning after a break).
- `docs/regression-baseline.md`: the pattern-regression baseline used by review tooling.
