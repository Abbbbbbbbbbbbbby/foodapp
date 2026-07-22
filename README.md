# foodbox-data-app

Astro app for gathering data from hunger relief food box line participants, running on Cloudflare Workers.

**Live URL:** https://foodbox-data-app.jeff-be7.workers.dev

## How deployment works

Every push to `main` triggers Cloudflare Workers Builds, which runs `npm run build` and then `npx wrangler deploy`. There is no manual deploy step.

## Local development

```sh
npm install
npm run dev
```

## Manual deploy (rarely needed)

```sh
npm run deploy
```

## Config files to leave alone

- `wrangler.jsonc` is the Cloudflare deploy config. The `name` must stay `foodbox-data-app`, or builds will fail.
- `astro.config.mjs` wires in the `@astrojs/cloudflare` adapter.
