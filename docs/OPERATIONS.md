# Operations

## Local

```bash
npm install
npm run dev
npm test
```

## Supabase

Use the migration in `supabase/migrations`. The CLI was initialized with `npx supabase init`; apply migrations with your linked Supabase project or local Supabase stack.

## Worker

The worker requires direct DB access:

```bash
SUPABASE_DB_URL=postgres://... npm exec tsx worker/hermes-worker.ts
```

Use a secret-bearing server environment only. Do not run worker code in the browser.

## Auth Mode

Set `HERMES_AUTH_MODE=mock` only for local development without Supabase Auth. Production should omit this flag and send Supabase Auth bearer tokens plus `x-tenant-id` on API requests that access tenant data.

## GitHub

CI exists in `.github/workflows/ci.yml`. Configure a remote, then protect the main branch after the first push.
