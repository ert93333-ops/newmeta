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
- Token test responses expose only account, permission, and expiry status.

## Approval

- Read/report/analysis/validation: no approval.
- Meta upload, creative creation, PAUSED campaign/adset/ad creation, paid AI generation: approval required.
- ACTIVE transition, pause/delete, targeting change, creative replacement, catalog/feed mutation: admin/owner approval plus typed confirmation.
- Destructive actions require a second approval, and each approval must provide the typed confirmation.
- Budget mutation: hard block, no approval escape hatch.

## Audit

Risk actions write `audit_logs` with actor, tenant, object, before/after diff, approval id, IP/user agent when available, and result.

## Release Gates

`npm run supabase:validate` must pass before release. It applies committed migrations to a local Supabase database, runs schema lint, and runs security/performance advisors without touching linked or remote projects.

`npm run auth:smoke` should pass against the deployed production-mode app before customer access. It verifies that `/api/me` rejects unauthenticated requests, accepts a valid tenant membership, and optionally rejects a denied tenant id.

`npm run github:release-gates` should pass after the latest `main` CI run succeeds. It verifies that the release branch is synced to GitHub, CI passed for `HEAD`, and branch protection requires CI while disallowing force pushes and branch deletion. A GitHub plan limitation that blocks private-repo branch protection is a release blocker.
