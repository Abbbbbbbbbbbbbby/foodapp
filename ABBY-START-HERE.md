# Getting your project into this repo

Hi Abby! This repo is connected to Cloudflare. Once your code is on the `main` branch, every push automatically builds and deploys the site to:

**https://foodbox-data-app.jeff-be7.workers.dev**

Right now the repo contains a minimal working Astro skeleton, a placeholder that proves the deploy pipeline works. Your app replaces it, and your local project folder becomes this repo: you'll connect your folder to it and push, rather than starting over from a clone.

## The one rule

Two files carry the deploy config and must survive the merge:

- `wrangler.jsonc`: the `name` must stay `foodbox-data-app`
- `astro.config.mjs`: must keep the `@astrojs/cloudflare` adapter

Everything else (pages, components, styles, public assets) is yours.

## What to do: paste this into Claude Code

Open Claude Code in your app's directory and paste the whole block below.

> I have an Astro app in this directory. It needs to be pushed to an existing GitHub repo that already has Cloudflare deployment configured. Repo: `https://github.com/creightoncommunity/foodbox-data-app.git` — I have push access as a collaborator.
>
> Follow these steps in order:
>
> 1. **Preflight.** Confirm `git config user.name` and `git config user.email` return values (if not, ask me for them and set them), and that `gh auth status` succeeds (if not, have me run `gh auth login` and wait for me to finish).
> 2. **Snapshot my work.** If this directory is not a git repo, run `git init -b main`. If the current branch isn't `main`, rename it with `git branch -m main`. Commit everything as a safety snapshot before changing anything. Make sure `node_modules/`, `dist/`, `.astro/`, `.wrangler/`, and `.env` are gitignored first.
> 3. **Connect the remote.** `git remote add origin https://github.com/creightoncommunity/foodbox-data-app.git`, then `git fetch origin`. The remote's `main` has a starter skeleton with the Cloudflare deploy config.
> 4. **Merge the skeleton in.** Run `git merge origin/main --allow-unrelated-histories` and resolve conflicts with these rules:
>    - My app code (`src/`, `public/`, components, layouts, styles) always wins.
>    - Take the remote's `wrangler.jsonc` exactly as-is. The `name` must stay `foodbox-data-app` — deployment breaks if it changes.
>    - `astro.config.mjs` must keep the `@astrojs/cloudflare` adapter; merge my other Astro settings around it.
>    - `package.json`: keep my dependencies, and add the remote's `@astrojs/cloudflare`, `wrangler`, and `typescript` packages plus its `deploy` and `generate-types` scripts.
>    - Keep the remote's `README.md`, `ABBY-START-HERE.md`, and `worker-configuration.d.ts`.
> 5. **Verify it builds.** Run `npm install`, then `npm run build`. Fix any errors before going further — common ones are Astro version mismatches between my project and the skeleton, or pages that assume a static build (the Cloudflare adapter renders on the server by default; add `export const prerender = true` to pages that should stay static).
> 6. **Push.** Commit and push to `origin main`. Never force-push.
> 7. **Confirm.** Tell me when the push is done. Within a couple of minutes my changes should appear at https://foodbox-data-app.jeff-be7.workers.dev — if the site doesn't update, tell me to ask Jeff whether the Cloudflare build connection is active yet, and do not try to deploy directly with wrangler.

## How to know it worked

A minute or two after pushing, your changes appear at https://foodbox-data-app.jeff-be7.workers.dev. You can watch builds in the Cloudflare dashboard under Workers & Pages → foodbox-data-app → Deployments, or just refresh the site.

## After that

Normal workflow: make changes, commit, and push to `main`. The site updates itself, so you never run a deploy command.
