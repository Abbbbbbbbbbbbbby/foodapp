# foodbox-data-app

React PWA + Cloudflare Worker for food box line check-in, plus a separate desktop admin console Worker (`foodbox-admin`, `src/admin/`, `wrangler.admin.jsonc`). See README.md for architecture.

## Development

```sh
npm run dev          # wrangler dev on :8787 (serves dist/pwa, so build first)
npm run build        # Vite build + service-worker precache injection
npm run pwa:dev      # Vite dev server, frontend-only hot reload
npm run admin:dev    # admin console worker on :8788 (throwaway dev session secret)
```

Apply local migrations before testing API routes: `wrangler d1 migrations apply foodapp --local`

## Tests: run the suite that matches what you touched

- `npm test`: worker/API (`tests/worker/`)
- `npm run test:pwa`: offline queue and client libs (`tests/pwa/`)
- `npm run test:ui`: React components (`tests/pwa-ui/`)
- `npm run test:admin`: admin console worker (`tests/admin/`)
- `npm run test:scripts`: build tooling (`tests/scripts/`)
- `npm run test:e2e`: Playwright full-stack smoke (`tests/e2e/`)

## Rules

- New DB schema changes = new numbered file in `migrations/`; never edit an applied migration. Production migrations are applied manually with `--remote` and they require Jeff's prod wrangler login.
- The service worker (`src/pwa/public/sw.js`) must keep the `PRECACHE_URLS` marker line; the build injects asset URLs there and fails loudly if the marker is missing.
- Offline queue changes (`src/pwa/lib/offline.ts`) need tests: replay after network loss is the core feature.
- Do not add auth gating for data sensitivity. Food line data is not PII (explicit decision); SMS rate limits are the control.
- Push to `main` auto-deploys to production via Workers Builds.
