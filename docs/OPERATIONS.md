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

For a real Supabase Auth smoke test, run:

```bash
npm run auth:smoke
```

Required env: `HERMES_APP_URL` or `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_AUTH_SMOKE_EMAIL`, `SUPABASE_AUTH_SMOKE_PASSWORD`, and `SUPABASE_AUTH_SMOKE_TENANT_ID`. Optional: `SUPABASE_AUTH_SMOKE_DENIED_TENANT_ID` to verify cross-tenant denial. The script does not print tokens or passwords; if env is missing, it exits blocked instead of reporting a false pass.

## GitHub

CI exists in `.github/workflows/ci.yml` and runs typecheck, unit tests, local Supabase migration validation, and build. The workflow uses Node 24-native GitHub actions so release checks do not depend on the deprecated GitHub Actions Node 20 runtime. Configure a remote, then protect the main branch after the first push.
