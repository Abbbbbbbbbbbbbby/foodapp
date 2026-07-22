# Review findings — 2026-07-22

Full multi-agent review of the first app push (`cce1b63..4548d93`). All 89 tests pass locally; the worker layer, parameterized SQL, and test quality are in good shape. The items below are what needs fixing, ordered by priority. Work them on a branch and open a PR to `main` (see "Workflow" at the bottom) — do not push fixes directly to `main`.

**Scope decision (Jeff, 2026-07-22):** role-based authorization gating is intentionally NOT required. This is a public food line staffed by known volunteers; the data is not treated as sensitive PII for access-control purposes. Do not add admin-approval gates or `requireRole` restrictions to the existing routes. SMS abuse is handled by rate limiting instead (item 2).

## Priority 1 — the offline pipeline (data loss)

The offline queue is currently write-only: `queueItem` stores submissions in IndexedDB, but `getPending`/`removeItem` are never called, so offline check-ins are never synced and are silently lost. Fix as one unit:

1a. **Implement queue flush.** On app start and on the `window` `online` event, read the queue with `getPending()`, POST each item, and `removeItem()` only on success. Keep items on failure and retry on the next trigger.

1b. **Idempotency keys.** The client already generates a UUID per queued item; send it as the record id (or an `idempotency_key` field) so the server can dedupe. Server side: accept a client-supplied id on `POST /api/families` and `POST /api/visits`, use `INSERT` with a uniqueness check, and return the existing record (200) instead of creating a duplicate when the key was already processed. This makes replay-after-timeout safe.

1c. **Queue only on network failure.** In `EnterPage.tsx` (`handleLogVisit`, `handleWizardComplete`), only queue when the failure is network-class (fetch `TypeError`, no response). An `ApiError` means the server answered: 401 must surface a re-login prompt, 400/500 must surface an error to the volunteer. Never show the success summary for a server rejection.

1d. **Fix the partial-success bug.** If the family POST succeeds but the visit POST fails, only the visit should be retried or queued — currently the whole family is re-queued, which creates a duplicate family and loses the visit.

1e. **Guard `queueItem` itself.** It runs inside a catch with no guard; if IndexedDB is unavailable (private browsing, quota), the rejection is unhandled and the check-in vanishes. Wrap it and show a "could not save — do not let the car leave" error if even the queue write fails.

1f. **Visible pending state.** Show a pending-sync count in the UI (Layout or HomePage) so a volunteer can see unsynced items exist before closing the browser or switching devices.

## Priority 2 — SMS rate limiting

Usage profile: at most 6 volunteers, one roughly 2-hour window on Saturdays, once a week. Caps sized accordingly (generous for real use, tight against abuse), implemented as KV counters with TTL on `env.SESSIONS` (eventual consistency is fine at this scale). Return 429 with a bilingual message.

- OTP request (`/api/auth/login` + `/api/auth/register` combined), per phone: 1 per 60 seconds, max 4 per hour, max 8 per day.
- OTP request, global across all phones: max 30 per hour, max 60 per day. Expected legitimate load is under 15 SMS per event, so this caps a pumping attack at pennies while never touching real use.
- `/api/auth/verify`, per phone: max 5 attempts per active code, then invalidate the code (require requesting a new one). After 3 consecutive invalidated codes, lock the phone out for 15 minutes.

## Priority 3 — CI and error handling

3a. **Fix CI.** `.github/workflows/ci.yml` must run `npm run build` before the worker tests (miniflare requires `dist/pwa` to exist), and add a step for the scripts suite (`npm run test:scripts`).

3b. **Return 400 for malformed JSON.** Wrap `request.json()` in login/register/verify/families-POST/visits-POST the same way families-PATCH already does. Currently they 500.

3c. **Validate enums at the API boundary.** `handleCreate`/`handleUpdate` in `routes/families.ts` accept any values; bad enums die at the SQLite CHECK constraint as a 500. Add small guards for the union fields (`hispanic`, `health_insurance`, `snap_benefits`, `ami_bracket`, `language`) and basic number/string sanity, returning 400.

3d. **Service worker: don't cache error pages.** `sw.js` navigate handler must check `res.ok` before `cache.put` (the non-navigate branch already does). A cached 500 page would replace the app shell offline.

3e. **SummaryScreen bag marking:** add a catch with a visible error (currently `try/finally` only — a failed PATCH looks like success), and handle queued families (`id: ''`) explicitly instead of silently skipping them.

## Priority 4 — correctness details

4a. `getAmi` in `src/pwa/lib/ami.ts`: guard family size < 1 (currently returns `undefined`, and NaN comparisons misclassify as `>120%`). The migration script already clamps; the PWA should match.
4b. `updateFamily` in `src/worker/db.ts`: normalize `phone` like `insertFamily` does, or a PATCHed phone becomes unfindable by search.
4c. `sendOtpSms` hardcodes `+1` while `normalizePhone` accepts 7 to 11+ digits: canonicalize to exactly 10 digits (strip a leading 1 from 11-digit input, reject the rest with a 400) so the Twilio `To` is always valid.
4d. Fuzzy search: escape `%` and `_` in the LIKE prefix; consider accent folding for the first character ("Ángel" is currently unreachable by searching "Angel").
4e. Read-path booleans: D1 returns `0 | 1 | null` but `Family` types them `boolean | null`. Add a row mapper (or retype) so strict comparisons aren't silently wrong.

## Priority 5 — hygiene (fine to defer)

- Decide the fate of `question_settings`: the wizard hardcodes all 11 steps, so the table and `/api/questions` are dead config that will drift. Wire the wizard to it or remove it. If kept, note `/api/questions` currently requires no auth.
- Deduplicate the worker/PWA type copies (`Family`, `UserRole`, `YesNoDeclined`, `AmiBracket`) into a shared module.
- Update README.md, AGENTS.md, and ABBY-START-HERE.md — they still describe the old Astro skeleton. Restore wrangler to ^4 in devDependencies (the merge downgraded it to 3.x).
- Add component tests for the Wizard and the EnterPage state machine — the step-flow bug fixed in `82b36ab` is exactly the class of regression these would catch.
- Tighten login's 404 ("No account found") if phone-enumeration ever becomes a concern; low priority given the audience.

## Infrastructure state (already done — no action needed)

Production resources now exist in the CCF Cloudflare account and `wrangler.jsonc` on `main` points at them: D1 `foodapp` (migrations applied remotely), KV `SESSIONS`, and the Worker secrets `JWT_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`. `ENVIRONMENT` is set to `production` (tests override it to `test` in vitest config; use `.dev.vars` with `ENVIRONMENT=development` for local dev if needed). Do not change resource IDs or secrets from the app side.

## Workflow

Pull the latest `main` first (it contains this document, the corrected `wrangler.jsonc`, and the regression baseline in `graphify-out/`). Then:

1. `git checkout -b abby/review-fixes-1`
2. Work Priority 1 and 2 first; commit in small, reviewable pieces.
3. Run all three test suites before pushing: `npm run build && npm test && npm run test:pwa && npm run test:scripts` — and add tests for what you fix (the offline flush path especially).
4. Push the branch and open a PR to `main` with `gh pr create`. Do not merge it — Jeff reviews first.
