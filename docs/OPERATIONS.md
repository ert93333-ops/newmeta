# Operations

## Local

```bash
npm install
npm run dev
npm test
```

## Supabase

Use the migration in `supabase/migrations`. The CLI was initialized with `npx supabase init`; apply migrations with your linked Supabase project or local Supabase stack.

For release validation, run:

```bash
npm run supabase:validate
```

This starts the local Supabase database through Docker, resets it with committed migrations, runs schema lint, and runs local security/performance advisors. It uses `--local` only; do not replace it with linked or remote project validation in CI unless that environment is explicitly approved.

## Worker

The worker requires direct DB access:

```bash
SUPABASE_DB_URL=postgres://... npm exec tsx worker/hermes-worker.ts
```

Use a secret-bearing server environment only. Do not run worker code in the browser.

## Auth Mode

Set `HERMES_AUTH_MODE=mock` only for local development without Supabase Auth. Runtime production is detected when `NODE_ENV=production` or `VERCEL_ENV=production`.

Production must omit `HERMES_AUTH_MODE=mock`, provide Supabase user auth env vars, and send Supabase Auth bearer tokens plus `x-tenant-id` on API requests that access tenant data. If Supabase user config is missing in production, API context resolution fails closed with `SUPABASE_AUTH_REQUIRED`. If mock auth is explicitly enabled in production, it fails closed with `MOCK_AUTH_DISABLED_IN_PRODUCTION`.

## GitHub

CI exists in `.github/workflows/ci.yml` and runs typecheck, unit tests, local Supabase migration validation, and build. Configure a remote, then protect the main branch after the first push.
