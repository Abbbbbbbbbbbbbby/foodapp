# Getting your project into this repo

Hi Abby! This repo is connected to Cloudflare. Once your code is on the `main` branch, every push automatically builds and deploys the site to:

**https://foodbox-data-app.jeff-be7.workers.dev**

Right now the repo contains a minimal working Astro skeleton, a placeholder that proves the deploy pipeline works. Your job is to replace it with your real app.

## The one rule

Keep these files from this repo (or keep their contents intact if your project has its own versions):

- `wrangler.jsonc`: the `name` must stay `foodbox-data-app`
- `astro.config.mjs`: must keep the `@astrojs/cloudflare` adapter

Everything else (pages, components, styles, public assets) is yours to replace.

## Easiest path: paste this into Claude Code

Open Claude Code in the folder where your project lives and paste:

> Clone https://github.com/creightoncommunity/foodbox-data-app.git into a sibling folder. Move my Astro project's source (src/, public/, and any components, layouts, or styles) into the cloned repo, replacing the placeholder pages. Keep the cloned repo's wrangler.jsonc (name must stay "foodbox-data-app") and keep the @astrojs/cloudflare adapter in astro.config.mjs, merging in any other settings my project needs. Merge my package.json dependencies into the repo's package.json. Then run npm install and npm run build to make sure it builds cleanly, fix anything that breaks, and commit and push to the main branch.

## If Claude asks you to log in to GitHub

Run this in the terminal and follow the prompts:

```sh
gh auth login
```

You already have access to the repo. You just need to be signed in.

## How to know it worked

A minute or two after pushing, your changes appear at https://foodbox-data-app.jeff-be7.workers.dev. You can watch builds in the Cloudflare dashboard under Workers & Pages → foodbox-data-app → Deployments, or just refresh the site.

## After that

Normal workflow: make changes, commit, and push to `main`. The site updates itself, so you never run a deploy command.
