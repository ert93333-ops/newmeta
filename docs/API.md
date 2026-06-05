# API

All write-like routes parse request bodies through the guarded API JSON boundary and reject executable budget mutation payloads with `BUDGET_MUTATION_HARD_BLOCKED`. Credential-shaped request fields such as `access_token`, `refresh_token`, `client_secret`, `encrypted_access_token`, `token_iv`, `token_auth_tag`, `service_role_key`, `authorization`, and `token` are rejected with `CREDENTIAL_PAYLOAD_BLOCKED`; API responses redact those fields defensively if they are ever present.

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

`POST /api/variants/design` is treated as a paid variant batch operation. The request must include an `approvalRequestId` for an approved same-tenant `ai_paid_generation` approval whose `objectType` is `variant_batch`. On success, the API marks that approval `executed` and writes an audit log. Missing or mismatched approval returns `PAID_OPERATION_APPROVAL_REQUIRED`; a reused or unapproved request returns `APPROVAL_REQUIRED`.

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
    "expiresAt": "2026-06-05T04:00:00.000Z",
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

Approval requests expire before execution. Draft approvals expire after 24 hours, publish approvals after 4 hours, and destructive approvals after 1 hour. Approving or executing an expired request returns `APPROVAL_EXPIRED`.

`POST /api/approvals/:id/execute` also parses the request body through the budget hard-block boundary. If any executable budget mutation field is present, it returns `BUDGET_MUTATION_HARD_BLOCKED` before execution.

Approval execution goes through an action-specific executor registry. Local mock execution returns action-specific results such as `mock_created_ad_paused`, but production must not return a fake execution success; if `HERMES_APPROVAL_EXECUTION_MODE=mock` or the live executor is not configured, execution fails closed with `MOCK_EXECUTION_DISABLED_IN_PRODUCTION` or `LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED`.

Successful execution persists the action-specific execution result on `approval_requests.execution_result_json` before the API returns success.

## Cost and Data

- `POST /api/cost/estimate`
- `GET /api/cost/usage`
- `POST /api/data-deletion-requests`

`POST /api/cost/estimate` returns a cost guard decision and records an estimate. For paid operations such as `image_generation`, `video_generation`, and `variant_batch`, clients may include:

```json
{
  "operationType": "variant_batch",
  "settings": {
    "providerName": "mock-ai"
  },
  "approvalRequest": {
    "create": true,
    "objectId": "creative-control-1",
    "reason": "Generate approved A/B variants."
  }
}
```

The API creates a pending `ai_paid_generation` approval only when the estimate is inside the effective cost cap and the operation requires approval. Blocked estimates do not create approvals. Approval payloads store cost metadata only; executable budget mutation fields remain hard-blocked.

## Budget Policy

No route may execute budget changes. Budget-related recommendations are allowed only as text hypotheses or human-facing suggestions.
