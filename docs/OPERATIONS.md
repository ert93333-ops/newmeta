# Operations

## Local

```bash
npm install
npm run dev
npm test
```

## Supabase

Use the migration in `supabase/migrations`. The CLI was initialized with `npx supabase init`; apply migrations with your linked Supabase project or local Supabase stack.

`supabase/functions/hermes-api` is intentionally fail-closed. It requires a bearer token and then returns `EDGE_FUNCTION_NOT_CONFIGURED` until a dedicated worker/webhook handler is implemented for that path. Do not treat a deployed placeholder Edge Function as a live API surface.

For release validation, run:

```bash
npm run supabase:validate
```

This starts the local Supabase database through Docker, resets it with committed migrations, runs schema lint, and runs local security/performance advisors. It uses `--local` only; do not replace it with linked or remote project validation in CI unless that environment is explicitly approved.

## Worker

The worker requires direct DB access:

```bash
SUPABASE_DB_URL=postgres://... HERMES_WORKER_SECRET=... npm exec tsx worker/hermes-worker.ts
```

Use a secret-bearing server environment only. Do not run worker code in the browser. The worker process now fails closed before opening a DB connection unless `SUPABASE_DB_URL` and a `HERMES_WORKER_SECRET` of at least 32 characters are present.

The worker lifecycle is DB-owned:

- `private.claim_creative_job(worker_name)` claims one queued job with `FOR UPDATE SKIP LOCKED`.
- `private.complete_creative_job(job_id, worker_name, result)` marks only that worker's running job as `succeeded`.
- `private.fail_creative_job(job_id, worker_name, error, result)` requeues while `attempts < max_attempts`, then marks the job `failed`.

The default `max_attempts = 2` gives one retry after the first failed execution. These functions are private and executable by `service_role`; they are not exposed as public API routes.

For paid image/video generation jobs, the render API stores server-derived cost metadata in `creative_jobs.input_json`. The worker writes the terminal `cost_usage_logs` row in the same DB transaction as job completion/final failure, using `related_job_id = approval.id`. A retryable failure leaves the existing running reservation intact; a final failure closes it with zero actual cost. In production, paid generation API queueing and worker execution fail closed with `PAID_GENERATION_WORKER_NOT_CONFIGURED` until a real generation provider is wired behind the worker; local deterministic mock results must not be reported as paid production output.

## Auth Mode

Set `HERMES_AUTH_MODE=mock` only for local development without Supabase Auth. Runtime production is detected when `NODE_ENV=production` or `VERCEL_ENV=production`.

Production must omit `HERMES_AUTH_MODE=mock`, provide Supabase user auth env vars, and send Supabase Auth bearer tokens plus `x-tenant-id` on API requests that access tenant data. If Supabase user config is missing in production, API context resolution fails closed with `SUPABASE_AUTH_REQUIRED`. If mock auth is explicitly enabled in production, it fails closed with `MOCK_AUTH_DISABLED_IN_PRODUCTION`.

For deployment env validation, start from `.env.production.example` and run:

```bash
npm run env:release-gates
```

The gate blocks missing required Supabase/Meta/worker/OAuth-state/approval-execution/render env, missing auth-smoke env, missing token key id, placeholder values, `HERMES_AUTH_MODE=mock`, `HERMES_META_OAUTH_MODE` values other than `live`, `HERMES_APPROVAL_EXECUTION_MODE` values other than `live`, `HERMES_RENDER_PIPELINE_MODE` values other than `live`, localhost app/callback URLs, invalid `TOKEN_ENCRYPTION_KEY`, default `TOKEN_ENCRYPTION_KEY_ID=primary`, weak state/worker secrets, and secret-looking `NEXT_PUBLIC_*` names.

Generate the local secret values that Hermes is allowed to create itself with:

```bash
npm run env:generate-secrets
```

This prints fresh values for `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_ID`, `HERMES_OAUTH_STATE_SECRET`, and `HERMES_WORKER_SECRET`. It does not create Supabase credentials, Meta app credentials, smoke-test accounts, or public deployment URLs; those must come from the owning external services.

Before enabling paid estimate/approval flows, persist tenant cost settings through `PATCH /api/settings/<providerName>` so `POST /api/cost/estimate` can resolve server-owned pricing and caps for that provider. Without that row, the route fails closed with `COST_SETTINGS_NOT_CONFIGURED`.

In production, `POST /api/render/jobs` is fail-closed for the deterministic no-paid-operation render checker path unless `HERMES_RENDER_PIPELINE_MODE=live`. Paid `image_generation` and `video_generation` requests still use the approval-bound worker queue. This prevents release builds from reporting render readiness before the deployment explicitly enables the render pipeline mode.

Use `GET /api/ops/health` for deployment monitoring. The endpoint returns `503` until release env, Supabase, live Meta OAuth, live approval execution mode, token key rotation id, worker secret, and production render pipeline readiness are all configured. It reports only issue codes and configured/missing states, not raw secret values.

Meta OAuth connect and callback routes use an in-process request rate limiter keyed by client IP and user agent. This limits abuse at the app boundary; keep platform/CDN rate limits enabled in production as the outer layer.

Use `PATCH /api/settings/commerce-db` to store non-secret 자사몰 DB readiness metadata such as `sourceType`, `connectionConfigured`, and table mappings. Secrets must stay in the deployment secret manager or Supabase vault and should be represented only by server-owned references. `GET /api/integrations/commerce-db/status` reports whether those readiness fields are complete.

For a real Supabase Auth smoke test, run:

```bash
npm run auth:smoke
```

Required env: `HERMES_APP_URL` or `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_AUTH_SMOKE_EMAIL`, `SUPABASE_AUTH_SMOKE_PASSWORD`, and `SUPABASE_AUTH_SMOKE_TENANT_ID`. Optional: `SUPABASE_AUTH_SMOKE_DENIED_TENANT_ID` to verify cross-tenant denial. These same required values are now part of `npm run env:release-gates`, so a release cannot be declared ready before the smoke prerequisites exist. The script verifies bearer-only `/api/me` tenant membership bootstrap, explicit allowed-tenant `/api/me`, unauthenticated rejection, `PATCH /api/settings/budget` returning `BUDGET_MUTATION_HARD_BLOCKED`, and signed Meta connect URL generation. It does not call the Meta callback or exchange/store Meta tokens. The script does not print tokens or passwords; if env is missing, it exits blocked instead of reporting a false pass.

## GitHub

CI exists in `.github/workflows/ci.yml` and runs typecheck, unit tests, local Supabase migration validation, and build. The workflow uses Node 24-native GitHub actions so release checks do not depend on the deprecated GitHub Actions Node 20 runtime.

The repo is pushed to `https://github.com/ert93333-ops/newmeta.git` on `main`. Run the release gate after CI succeeds:

```bash
npm run github:release-gates
```

The gate checks a clean worktree, `main` synced to `origin/main`, latest CI success for `HEAD`, and branch protection requiring CI with force pushes/deletions disabled. If GitHub reports that branch protection is unavailable for a private repository on the current plan, do not treat the repo as release-ready; upgrade the plan or make the repository public, then enable branch protection.
