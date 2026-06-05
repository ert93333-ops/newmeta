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

## Token Handling

- Tokens are never returned to clients.
- Tokens are encrypted with AES-256-GCM before storage.
- Logs must not include access tokens, refresh tokens, app secrets, authorization codes, or service keys.
- Write API payloads reject token-shaped fields and encrypted token material before persistence or audit logging. API responses and audit JSON payloads defensively redact those fields.
- Meta OAuth callback exchanges codes server-side and stores only encrypted token material. `HERMES_META_OAUTH_MODE=mock` is local-only; release requires `HERMES_META_OAUTH_MODE=live`.
- Meta OAuth state is signed, expires after 10 minutes, and is bound to the authenticated user and tenant through hashed identifiers. Production requires `HERMES_OAUTH_STATE_SECRET`.
- Token test responses expose only account, permission, and expiry status.

## Approval

- Read/report/analysis/validation: no approval.
- Meta upload, creative creation, PAUSED campaign/adset/ad creation, paid AI generation: approval required.
- ACTIVE transition, pause/delete, Meta connection disconnect, tenant data deletion, targeting change, creative replacement, catalog/feed mutation: admin/owner approval plus typed confirmation.
- Destructive actions require a second approval, and each approval must provide the typed confirmation.
- Approval requests have finite TTLs: draft 24 hours, publish 4 hours, destructive 1 hour. Expired approvals cannot be approved or executed.
- Budget mutation: hard block, no approval escape hatch.
- Approval execution must go through the action-specific executor registry and fail closed in production unless a real live executor is configured; mock execution is local-only.
- Approval execution must persist the executor result, and Supabase approval updates must confirm that a row was actually updated so RLS or tenant mismatches cannot be reported as successful execution.

## Audit

Risk actions write `audit_logs` with actor, tenant, object, before/after diff, approval id, IP/user agent when available, and result.

## Release Gates

`npm run supabase:validate` must pass before release. It applies committed migrations to a local Supabase database, runs schema lint, and runs security/performance advisors without touching linked or remote projects.

`npm run env:release-gates` must pass against the deployment environment before release. It fails closed if mock auth or mock Meta OAuth is enabled, required Supabase/Meta/worker/OAuth-state env is missing, placeholder values remain, token encryption is invalid, callback URLs point to localhost, weak state/worker secrets are configured, or secret-looking values are placed behind `NEXT_PUBLIC_*`.

`npm run auth:smoke` should pass against the deployed production-mode app before customer access. It verifies that `/api/me` rejects unauthenticated requests, accepts a valid tenant membership, and optionally rejects a denied tenant id.

`npm run github:release-gates` should pass after the latest `main` CI run succeeds. It verifies that the release branch is synced to GitHub, CI passed for `HEAD`, and branch protection requires CI while disallowing force pushes and branch deletion. A GitHub plan limitation that blocks private-repo branch protection is a release blocker.
