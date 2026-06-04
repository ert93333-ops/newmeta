# API

All write-like routes parse request bodies through the guarded API JSON boundary and reject executable budget mutation payloads with `BUDGET_MUTATION_HARD_BLOCKED`.

Routes resolve tenant/user context before persistence. In production, send a Supabase Auth bearer token and `x-tenant-id`; local mock mode falls back to the default mock tenant.

Tenant-scoped GET routes also use the shared error boundary, so missing auth returns `AUTH_REQUIRED`/`SUPABASE_AUTH_REQUIRED` with 401 instead of an unhandled server error.

## Identity

- `GET /api/me`
- `GET /api/tenants/:id`
- `PATCH /api/settings/*`

## Meta

- `GET /api/integrations/meta/connect-url`
- `POST /api/integrations/meta/callback`
- `DELETE /api/integrations/meta/:id`
- `GET /api/meta/ad-accounts`
- `POST /api/meta/sync/insights`

## Creative and Diagnosis

- `POST /api/creative-assets`
- `POST /api/creative-analysis/jobs`
- `GET /api/jobs/:id`
- `POST /api/render/jobs`
- `POST /api/placement/validate`
- `POST /api/bottleneck/jobs`
- `POST /api/performance-fusion/reports`
- `POST /api/variants/design`

## Draft and Approval

- `POST /api/drafts/preflight`
- `POST /api/drafts/create-paused`
- `POST /api/approvals`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/reject`
- `POST /api/approvals/:id/execute`

`POST /api/approvals` and `POST /api/approvals/:id/approve` include approval guard metadata:

```json
{
  "guard": {
    "riskLevel": "publish",
    "requiresSecondApproval": false,
    "typedConfirmationRequired": true,
    "requiredText": "APPROVE meta_activate_ad"
  }
}
```

Publish and destructive approvals require a typed confirmation in the approve body:

```json
{
  "typedConfirmation": "APPROVE meta_activate_ad"
}
```

If the confirmation is missing or wrong, the API returns `TYPED_CONFIRMATION_REQUIRED` with `details.requiredText`.

`POST /api/approvals/:id/execute` also parses the request body through the budget hard-block boundary. If any executable budget mutation field is present, it returns `BUDGET_MUTATION_HARD_BLOCKED` before execution.

Approval execution goes through an action-specific executor registry. Local mock execution returns action-specific results such as `mock_created_ad_paused`, but production must not return a fake execution success; if `HERMES_APPROVAL_EXECUTION_MODE=mock` or the live executor is not configured, execution fails closed with `MOCK_EXECUTION_DISABLED_IN_PRODUCTION` or `LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED`.

## Cost and Data

- `POST /api/cost/estimate`
- `GET /api/cost/usage`
- `POST /api/data-deletion-requests`

## Budget Policy

No route may execute budget changes. Budget-related recommendations are allowed only as text hypotheses or human-facing suggestions.
