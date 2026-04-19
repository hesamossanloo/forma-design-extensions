# forma-design-extensions

Source monorepo for Autodesk Forma extensions published under `https://hesam.info/forma-design-extensions/...`.

## Current apps

- `apps/where-is-the-fire`: Wildfire detection viewer for Forma projects.

## Local development

1. Copy `.env.example` to `.env.local` in `apps/where-is-the-fire` or export the variables in your shell.
2. Install dependencies with `pnpm install`.
3. Run `pnpm dev:fire`.

Useful shortcuts:

- `pnpm dev:fire`
- `pnpm build:fire`
- `pnpm preview:fire`
- `pnpm typecheck:fire`

Required variables:

- `VITE_FORMA_CLIENT_ID`: Autodesk OAuth client ID. This is public in browser apps.
- `VITE_NASA_MAP_KEY`: NASA FIRMS key used by the browser. Do not commit it, but it is still visible client-side after deploy.

## Deploy model

This repo builds each extension as a static app. GitHub Actions publishes the built output into the Pages repo `hesamossanloo/hesamossanloo.github.io` under:

- `public/forma-design-extensions/where-is-the-fire/`

That repo already owns the `hesam.info` custom domain and deploys the final Pages site.

## GitHub secrets

Configure these secrets in `hesamossanloo/forma-design-extensions`:

- `VITE_FORMA_CLIENT_ID`
- `VITE_NASA_MAP_KEY`
- `PERSONAL_PAGES_REPO_TOKEN`: fine-grained token with write access to `hesamossanloo/hesamossanloo.github.io`

## OAuth callback

Register this callback URL in Autodesk APS for production:

- `https://hesam.info/forma-design-extensions/where-is-the-fire/auth/`
