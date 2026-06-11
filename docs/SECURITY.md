# Security

## Tenant Isolation

All tenant data is scoped by `tenant_id`. Supabase RLS policies call `private.has_tenant_role(...)` to ensure the authenticated user belongs to the tenant with a sufficient role.

Roles:

- Owner
- Admin
- Marketer
- Analyst
- Viewer

Authorization must not depend on user-editable metadata. Server-only code handles privileged operations.

API routes must resolve user context from Supabase Auth and `user_roles` before reading or writing tenant data. The local mock context is only a non-production fallback when Supabase env vars are absent or `HERMES_AUTH_MODE=mock`; production runtime fails closed instead of creating an owner mock context.

Tenant-scoped settings writes go through `PATCH /api/settings/*`, require `marketer` or above, persist into `integration_settings`, and write an audit log. Budget-namespaced settings paths are hard-blocked instead of being treated as normal persistence.

## Token Handling

- Tokens are never returned to clients.
- Tokens are encrypted with AES-256-GCM before storage.
- Logs must not include access tokens, refresh tokens, app secrets, authorization codes, or service keys.
- Write API payloads reject token-shaped fields and encrypted token material before persistence or audit logging. API responses and audit JSON payloads defensively redact those fields.
- Meta OAuth callback exchanges codes server-side and stores only encrypted token material. `HERMES_META_OAUTH_MODE=mock` is local-only; release requires `HERMES_META_OAUTH_MODE=live`.
- Meta OAuth state is signed, expires after 10 minutes, and is bound to the authenticated user and tenant through hashed identifiers. Production requires `HERMES_OAUTH_STATE_SECRET`.
- Meta OAuth connect and callback routes are rate-limited at the app boundary by client IP and user agent. Production should also keep CDN/platform rate limits enabled.
- Release requires an explicit `TOKEN_ENCRYPTION_KEY_ID` so newly stored encrypted Meta tokens have a non-default key id and future rotation can identify which server key was active.
- Tenant data deletion has a dedicated domain executor at `POST /api/data-deletion-requests/:id/execute`. Generic approval execution stays blocked for this action so deletion scope, persistence cleanup, approval consumption, and audit logging run together.
- Token test responses expose only account, permission, and expiry status.

## Approval

- Read/report/analysis/validation: no approval.
- Meta upload, creative creation, PAUSED campaign/adset/ad creation, paid AI generation: approval required.
- ACTIVE transition, pause/delete, Meta connection disconnect, tenant data deletion, targeting change, creative replacement, catalog/feed mutation: admin/owner approval plus typed confirmation.
- Destructive actions require a second approval, and each approval must provide the typed confirmation.
- Approval requests have finite TTLs: draft 24 hours, publish 4 hours, destructive 1 hour. Expired approvals cannot be approved or executed.
- Approval request listing is tenant-scoped and returns guard metadata so clients do not infer approval policy from user-editable fields.
- Budget mutation: hard block, no approval escape hatch.
- Cost guard settings must be server-owned. `POST /api/cost/estimate` may accept a provider lookup key from the client, but pricing, credits, and caps must come from tenant-scoped `integration_settings`, not request-body overrides.
- Worker execution requires server-only runtime configuration and fails closed before connecting to Postgres unless `SUPABASE_DB_URL` and a strong `HERMES_WORKER_SECRET` are configured.
- Paid image/video generation worker execution is local-mock only until a real provider is wired; production workers fail closed with `PAID_GENERATION_WORKER_NOT_CONFIGURED` instead of recording deterministic mock output as paid production output.
- Approval execution must go through the action-specific executor registry and fail closed in production unless a real live executor is configured; mock execution is local-only.
- Generic live approval execution is limited to direct Meta status mutations already modeled by Hermes (`meta_activate_campaign`, `meta_activate_adset`, `meta_activate_ad`, `meta_pause_ad`, `meta_delete_ad`). Those paths resolve the stored tenant-scoped Meta connection server-side and send the Graph mutation with bearer auth headers; unsupported generic actions still fail closed in live mode.
- `meta_create_ad_paused` is no longer executable through the generic `POST /api/approvals/:id/execute` route. Generic execution must return `APPROVAL_ACTION_EXECUTOR_REQUIRED` for that action so paused-draft approvals can only be consumed by `POST /api/drafts/create-paused`.
- `tenant_data_deletion` is also no longer executable through the generic `POST /api/approvals/:id/execute` route. It must be executed only through `POST /api/data-deletion-requests/:id/execute`, where the request lifecycle, tenant cleanup, approval consumption, and audit log stay in one domain path.
- `POST /api/drafts/create-paused` must not bypass that rule. The route now validates execution readiness before it even creates a pending approval request, then executes real live Meta PAUSED draft creation only through the server-side Graph adapter chain. If the route is missing prerequisites such as persisted tenant asset lookup, Meta ad account id, asset `sourceUrl`, or video `thumbnailUrl`, it must fail closed instead of creating a non-executable approval or persisting a false-success draft.
- If live paused-draft execution creates upstream Meta objects and then fails later in the chain, the approval must be marked `cancelled`, not left `approved`. Partial Meta ids must be persisted in `approval_requests.execution_result_json` and the audit log so operators can reconcile external side effects without reusing the same approval.
- Approval execution must persist the executor result, and Supabase approval updates must confirm that a row was actually updated so RLS or tenant mismatches cannot be reported as successful execution.

## Audit

Risk actions write `audit_logs` with actor, tenant, object, before/after diff, approval id, IP/user agent when available, and result.

## Release Gates

`npm run supabase:validate` must pass before release. It applies committed migrations to a local Supabase database, runs schema lint, and runs security/performance advisors without touching linked or remote projects.

`npm run env:release-gates` must pass against the deployment environment before release. It fails closed if mock auth or mock Meta OAuth is enabled, required Supabase/Meta/worker/OAuth-state env is missing, placeholder values remain, token encryption is invalid, callback URLs point to localhost, weak state/worker secrets are configured, or secret-looking values are placed behind `NEXT_PUBLIC_*`.

`npm run auth:smoke` should pass against the deployed production-mode app before customer access. It verifies that `/api/me` rejects unauthenticated requests, accepts a valid tenant membership, rejects `PATCH /api/settings/budget` with `BUDGET_MUTATION_HARD_BLOCKED`, and optionally rejects a denied tenant id.

`npm run github:release-gates` should pass after the latest `main` CI run succeeds. It verifies that the release branch is synced to GitHub, CI passed for `HEAD`, and branch protection requires CI while disallowing force pushes and branch deletion. A GitHub plan limitation that blocks private-repo branch protection is a release blocker.
