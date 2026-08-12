# foodbox-data-app

Check-in app for a hunger relief food box line. Volunteers register with their phone number, look up or add families as cars come through, and record each visit and bag count. Built to keep working when the WiFi doesn't.

**Live URL:** https://foodbox-data-app.jeff-be7.workers.dev

## Architecture

- **Frontend:** React PWA (`src/pwa/`), built with Vite. Targets old iPads (iOS 9.3.5) via `@vitejs/plugin-legacy`. A service worker precaches the app shell so it loads offline; writes queue in IndexedDB and flush when the network returns.
- **Backend:** Cloudflare Worker (`src/worker/`) serving `/api/*`, with the built PWA served as static assets. Data lives in D1 (SQLite); sessions in KV. SMS one-time codes go out through Twilio.
- **Auth:** phone number + OTP. Anyone can self-register as a volunteer; SMS rate limits are the abuse control (this is intentional: food line data is not PII).

## Local development

```sh
npm install
npm run dev          # wrangler dev: worker + built PWA on :8787 (build first)
npm run pwa:dev      # Vite dev server for frontend-only work with hot reload
```

`npm run dev` serves whatever is in `dist/pwa`, so run `npm run build` after frontend changes. Local D1/KV are emulated; apply migrations with `wrangler d1 migrations apply foodapp --local`.

## Tests

```sh
npm test             # worker API tests (vitest-pool-workers, real D1/KV emulation)
npm run test:pwa     # offline queue / client lib tests (fake-indexeddb)
npm run test:ui      # React component tests (RTL + jsdom)
npm run test:scripts # build tooling tests (precache injection)
npm run test:e2e     # Playwright smoke: boots the real stack, runs the full volunteer journey
```

The e2e run builds the app, applies migrations to local D1, and starts `wrangler dev` with `ENVIRONMENT=test`, which enables a test-only endpoint for reading OTP codes. That endpoint does not exist in production.

## Database migrations

Migrations live in `migrations/` and are numbered. Local and test environments apply them automatically where needed; production requires an explicit:

```sh
npx wrangler d1 migrations apply foodapp --remote
```

Run that as part of any deploy that includes a new migration file.

`scripts/backfill-normalized.mjs` backfills `name_normalized` for rows imported before normalization existed (one-time, idempotent; pass `--remote` for production).

## Deployment

Every push to `main` triggers Cloudflare Workers Builds, which runs `npm run build` and `npx wrangler deploy`. There is no manual deploy step in the normal flow. Branch pushes get preview URLs.

Manual deploy if ever needed: `npm run deploy`.

## Config notes

- `wrangler.jsonc` is the deploy config. The `name` must stay `foodbox-data-app`. It references the production D1 database and KV namespace by ID; local dev never touches that data.
- CI (`.github/workflows/ci.yml`) runs typechecks and all four unit suites on every push. The e2e workflow (`.github/workflows/e2e.yml`) runs on manual dispatch.
