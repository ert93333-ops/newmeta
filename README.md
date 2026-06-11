# newmeta / Hermes

Hermes is an internal-first, SaaS-ready Meta Ads creative operations platform. It connects Meta ad accounts, analyzes image/video creatives, diagnoses funnel bottlenecks, validates placement compatibility, creates PAUSED drafts, and routes every risky action through approval.

## Non-Negotiable Guardrails

- Budget mutation is hard-blocked. The system can recommend budget changes, but it has no budget mutation approval action, API endpoint, or adapter method.
- External customer Meta access uses OAuth / Business Login. Customers are not asked to paste access tokens.
- Access tokens are encrypted server-side and never returned to the browser.
- Tenant data stays isolated by `tenant_id` and Supabase RLS.
- ACTIVE transitions and destructive actions require approval. Destructive actions require a second approval.
- Approval requests expire before execution: draft 24h, publish 4h, destructive 1h.
- Final ad images must not contain safezone, pixel, guide, or layout labels.
- Cross-tenant learning only uses anonymized, aggregated, opt-in patterns.

## Stack

- Next.js + TypeScript for UI and API orchestration
- Supabase Auth, Postgres, Storage-ready schema, and optional Edge Functions
- Separate worker process for long-running video/render/AI work
- Vitest for core engine and guardrail tests
- GitHub Actions CI for typecheck, lint, tests, local Supabase migration validation, and build

## Quick Start

```bash
npm install
npm run typecheck
npm test
npm run supabase:validate
npm run build
npm run dev
```

Copy `.env.example` to `.env.local` for local Supabase/Meta credentials. Use `MockMetaAdapter` for safe development without ad spend.

For local development without a Supabase project, keep `HERMES_AUTH_MODE=mock`. Production refuses mock auth. `/api/me` can bootstrap the authenticated user's tenant memberships from a Supabase bearer token; tenant-scoped routes require the bearer token plus `x-tenant-id`. `GET /api/tenants/:id` returns only the caller's membership-scoped tenant metadata and denies non-member tenants. `POST /api/creative-assets` now validates normalized asset shape before persistence, stores tenant-scoped `creative_assets` rows with storage/source/checksum metadata, and writes an audit log instead of accepting arbitrary asset JSON. `POST /api/drafts/preflight` remains analysis-only but still requires tenant auth. `POST /api/creative-analysis/jobs` now requires a persisted same-tenant `asset.id`, uses the stored asset metadata as the source of truth for type, dimensions, and duration, mirrors its id into both `/api/jobs/:id` and `creative_analysis_jobs`, and expands the result into `creative_features`, `creative_component_scores`, and `video_segments` where applicable. `POST /api/placement/validate` now persists tenant-scoped `placement_validation_reports` rows and writes an audit log instead of returning an ephemeral validation result only. `POST /api/bottleneck/jobs` now persists `bottleneck_analysis_jobs`, `bottleneck_stage_scores`, and derived `bottleneck_hypotheses` rows under the same job id that the generic `/api/jobs/:id` surface returns. `POST /api/performance-fusion/reports` now persists tenant-scoped fusion reports instead of returning report JSON only. `PATCH /api/settings/*` now persists tenant-scoped settings through `integration_settings` and requires `marketer` or above. `POST /api/integrations/meta/callback` now ignores browser-supplied `scopes`, stores only server-resolved granted scopes from the Meta token exchange, and refuses live connections that did not actually receive all required scopes. `DELETE /api/integrations/meta/:id` now fails closed unless the referenced `meta_connections` row exists for the current tenant, and executing the approved disconnect now scrubs stored token material plus marks that row `revoked`, so destructive disconnect approvals cannot target arbitrary ids or leave reusable server tokens behind. `GET /api/meta/ad-accounts`, `POST /api/meta/sync/insights`, and other live Meta paths now also revalidate stored `meta_connections` rows for the required scope set so older incomplete connections fail closed instead of being reused. `GET /api/data-deletion-requests` now returns the tenant's persisted deletion-request rows with lifecycle metadata, and `POST /api/data-deletion-requests` persists a tenant-scoped `data_deletion_requests` row before it writes the destructive approval. That stored row begins at `approval_required`, approve/reject actions sync its lifecycle metadata, and a blocked generic execute attempt now records the required domain route, actor/time, and audit breadcrumb instead of leaving the request row opaque. `POST /api/drafts/create-paused` reruns preflight on the server, requires a persisted same-tenant creative asset plus `adAccountId`, validates the same live/mock execution prerequisites before it creates a pending approval, runs the mock Meta adapter chain in local-safe mode, and for stored live Meta connections executes the Graph upload/creative/campaign/adset/ad PAUSED chain server-side. Live execution requires a persisted asset `sourceUrl`, video drafts require `payload.thumbnailUrl`, and live ad sets now fail closed on empty targeting or missing objective-specific `promotedObject` fields such as conversion pixel/event, product catalog id, or app store metadata. Live campaign and ad set creation also run Meta `execution_options=["validate_only"]` checks before the real create step and surface sanitized provider errors earlier. If live execution creates upstream Meta objects and then fails later in the chain, Hermes now cancels the approval, records the partial Meta ids on `approval_requests.execution_result_json` and the audit log, and returns a sanitized partial-failure response instead of leaving the approval reusable. The matching `meta_create_ad_paused` approval can now be consumed only by `POST /api/drafts/create-paused`, and `tenant_data_deletion` likewise no longer executes through the generic `POST /api/approvals/:id/execute` route, so Hermes cannot report a fake destructive success without a dedicated domain executor. `POST /api/cost/estimate` reads provider pricing and caps from the tenant's stored `integration_settings` row keyed by `settings.providerName` and fails closed when that row is missing. `GET /api/cost/usage` now requires `providerName` too and returns the same server-owned provider policy plus computed `effectiveDailyCapKrw` instead of hardcoded defaults. `GET /api/meta/ad-accounts` and `POST /api/meta/sync/insights` now resolve their Meta adapter server-side: they use the latest tenant-scoped encrypted `meta_connections` record when present, and only fall back to `MockMetaAdapter` outside production when no live connection exists.

For deployment, start from `.env.production.example`, omit `HERMES_AUTH_MODE=mock`, and run:

```bash
npm run env:release-gates
```

The gate fails closed on missing production Supabase/Meta/worker/OAuth-state/approval-execution/render env, missing auth-smoke env, placeholder values, localhost app/callback URLs, invalid `TOKEN_ENCRYPTION_KEY`, weak state/worker secrets, and secret-looking `NEXT_PUBLIC_*` names.

Hermes can generate only the local release secrets it owns:

```bash
npm run env:generate-secrets
```

Use the printed values for `TOKEN_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY_ID`, `HERMES_OAUTH_STATE_SECRET`, and `HERMES_WORKER_SECRET`. Supabase credentials, Meta app credentials, smoke-test accounts, and production URLs still have to come from those external services.

## Important Files

- `src/lib/guards/budget-guard.ts`: hard block for executable budget mutations
- `src/lib/approval/approval-policy.ts`: risk-level approval policy
- `src/lib/meta/*`: Meta adapter interface and mock/Graph/MCP adapters
- `src/lib/placement/placement-validator.ts`: placement and #1487569 preflight guard
- `src/lib/drafts/preflight.ts`: draft creation preflight
- `supabase/migrations/*_hermes_foundation_schema.sql`: tenant/RLS schema
- `supabase/functions/hermes-api/index.ts`: fail-closed Edge Function placeholder reserved for dedicated worker/webhook endpoints
- `worker/hermes-worker.ts`: DB-backed worker claim loop skeleton
- `docs/`: API, DB, security, cost, Meta, and operation notes

## Supabase Notes

The migration follows current Supabase RLS guidance: RLS is enabled on exposed tables, policies are scoped to the `authenticated` role, and authorization does not rely on user-editable metadata. Server-only keys and token encryption keys must stay out of `NEXT_PUBLIC_*`.

Run `npm run supabase:validate` with Docker running to apply migrations to the local Supabase database, run schema lint, and run local security/performance advisors. The script only uses local Supabase and redacts local generated keys from command output.

Run `npm run auth:smoke` against a deployed or production-mode app after setting `HERMES_APP_URL`, Supabase publishable env, smoke user credentials, and `SUPABASE_AUTH_SMOKE_TENANT_ID`. It verifies `/api/me` rejects unauthenticated traffic, bootstraps tenant memberships from the signed-in user, accepts the allowed tenant, rejects `PATCH /api/settings/budget` with `BUDGET_MUTATION_HARD_BLOCKED`, prepares a signed Meta connect URL without exchanging Meta tokens, and optionally rejects `SUPABASE_AUTH_SMOKE_DENIED_TENANT_ID`.

Relevant official docs checked during implementation:

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)

`POST /api/approvals/:id/execute` now supports live execution for the generic Meta status actions Hermes already models directly: `meta_activate_campaign`, `meta_activate_adset`, `meta_activate_ad`, `meta_pause_ad`, and `meta_delete_ad`. Those executions resolve the tenant's stored Meta connection server-side and send the status mutation through Graph with bearer auth in headers. Unsupported generic actions still fail closed in live mode.

## GitHub

This folder is pushed to `https://github.com/ert93333-ops/newmeta.git` on `main` and includes `.github/workflows/ci.yml`.

Run the GitHub release gate after the latest `main` CI run succeeds:

```bash
npm run github:release-gates
```

The gate verifies that `main` is clean, synced to `origin/main`, the latest CI run succeeded for `HEAD`, and branch protection requires CI without force pushes or branch deletion. If GitHub reports that branch protection is unavailable for a private repository on the current plan, treat that as a release blocker rather than a pass.
