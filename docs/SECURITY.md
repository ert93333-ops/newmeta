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

## Token Handling

- Tokens are never returned to clients.
- Tokens are encrypted with AES-256-GCM before storage.
- Logs must not include access tokens, refresh tokens, app secrets, authorization codes, or service keys.
- Token test responses expose only account, permission, and expiry status.

## Approval

- Read/report/analysis/validation: no approval.
- Meta upload, creative creation, PAUSED campaign/adset/ad creation, paid AI generation: approval required.
- ACTIVE transition, pause/delete, targeting change, creative replacement, catalog/feed mutation: admin/owner approval and second approval for destructive actions.
- Budget mutation: hard block, no approval escape hatch.

## Audit

Risk actions write `audit_logs` with actor, tenant, object, before/after diff, approval id, IP/user agent when available, and result.
