# API

All write-like routes parse request bodies through the guarded API JSON boundary and reject executable budget mutation payloads with `BUDGET_MUTATION_HARD_BLOCKED`. Credential-shaped request fields such as `access_token`, `refresh_token`, `client_secret`, `encrypted_access_token`, `token_iv`, `token_auth_tag`, `service_role_key`, `authorization`, and `token` are rejected with `CREDENTIAL_PAYLOAD_BLOCKED`; API responses redact those fields defensively if they are ever present.

Routes resolve tenant/user context before persistence. In production, `/api/me` can bootstrap the authenticated user's tenant memberships from a Supabase Auth bearer token alone. Tenant-scoped routes require the bearer token plus `x-tenant-id`; local mock mode falls back to the default mock tenant.

Tenant-scoped GET routes also use the shared error boundary, so missing auth returns `AUTH_REQUIRED`/`SUPABASE_AUTH_REQUIRED` with 401 instead of an unhandled server error.

## Identity

- `GET /api/me`
- `GET /api/tenants/:id`
- `PATCH /api/settings/*`

`GET /api/me` returns `memberships` and `activeTenant`. If `x-tenant-id` is provided, it verifies the requested tenant is one of the authenticated user's memberships and returns `TENANT_ACCESS_DENIED` otherwise. Without `x-tenant-id`, it returns the first visible membership as `activeTenant` so browser clients can choose a tenant before calling tenant-scoped APIs.

`GET /api/tenants/:id` returns only membership-scoped tenant metadata for the requested tenant: `id`, `name`, `role`, `isInternal`, and `crossTenantLearningOptIn`. The route resolves identity from the current bearer token, denies tenants outside the caller's memberships with `TENANT_ACCESS_DENIED`, and never falls back to a cross-tenant tenant lookup.

`PATCH /api/settings/*` requires the authenticated tenant context plus at least `marketer` role. It persists the request body to the tenant's `integration_settings` row keyed by the route path, writes an audit log with before/after JSON, and rejects any route path containing `budget` with `BUDGET_MUTATION_HARD_BLOCKED` even when the body itself is non-executable.

## Meta

- `GET /api/integrations/meta/connect-url`
- `GET /api/integrations/meta/callback`
- `POST /api/integrations/meta/callback`
- `DELETE /api/integrations/meta/:id`
- `GET /api/meta/ad-accounts`
- `POST /api/meta/sync/insights`

`POST /api/integrations/meta/callback` accepts an OAuth authorization code, exchanges it server-side, resolves granted scopes server-side from the resulting Meta token, verifies that all required scopes were actually granted, encrypts that token, stores it in `meta_connections`, writes an audit record, and returns only connection metadata such as `encryptedTokenStored`. Local mock exchange is disabled for release by `npm run env:release-gates`.

`GET /api/integrations/meta/connect-url` includes a signed, expiring `state` query parameter in `connectUrl`. `POST /api/integrations/meta/callback` must receive that same `state`; missing, expired, tampered, or cross-tenant state returns `META_OAUTH_STATE_REQUIRED`, `META_OAUTH_STATE_EXPIRED`, `META_OAUTH_STATE_INVALID`, or `META_OAUTH_STATE_TENANT_MISMATCH` before any token exchange or persistence. The POST route no longer trusts a browser-supplied `scopes` array; live mode resolves granted scopes from Meta server-side and fails closed with `META_OAUTH_PERMISSIONS_FETCH_FAILED`, `META_OAUTH_SCOPES_UNAVAILABLE`, or `META_REQUIRED_SCOPES_MISSING` if that lookup cannot be completed or if the granted permission set is incomplete. In local mock mode the route may fall back to mock app metadata, but when `HERMES_META_OAUTH_MODE=live` it now fails closed with `META_OAUTH_LIVE_NOT_CONFIGURED` unless `META_APP_ID` and `META_REDIRECT_URI` are configured.

`GET /api/integrations/meta/callback` only performs browser handoff. It redirects Meta's GET callback to `/meta/oauth/callback#code=...&state=...` and never exchanges or persists tokens itself. The client handoff page clears the fragment and calls the guarded POST route with the current Supabase session and tenant context. In production this handoff now requires `HERMES_APP_URL` or `NEXT_PUBLIC_APP_URL`; without one it fails closed with `PUBLIC_APP_URL_REQUIRED` instead of guessing from the request origin.

`DELETE /api/integrations/meta/:id` does not immediately remove tokens or integration data. It first verifies that the referenced `meta_connections` row exists for the current tenant. If not, it fails closed with `META_CONNECTION_NOT_FOUND` instead of writing an approval against an arbitrary id. When the row exists, the route creates a tenant-scoped destructive `meta_disconnect_connection` approval request, writes an audit record, and returns typed-confirmation guard metadata with the stored connection status/mode in `beforeJson`. Actual cleanup must happen only after the two-step destructive approval flow.

`GET /api/meta/ad-accounts` resolves the Meta adapter on the server. If the tenant has a connected live `meta_connections` record, the route decrypts that token server-side and uses `MetaGraphApiAdapter`; otherwise, only non-production runtime may fall back to `MockMetaAdapter`. Production without a live connection returns `META_CONNECTION_REQUIRED`. Stored live connections are also revalidated for the required Meta scope set at runtime; old or incomplete connections now fail closed with `META_REQUIRED_SCOPES_MISSING`.

`POST /api/meta/sync/insights` uses the same adapter resolution. In mock mode it can default to `act_mock_001`; live mode requires an explicit `adAccountId` and returns `META_AD_ACCOUNT_REQUIRED` otherwise. The route records the adapter mode inside the saved job input and writes an audit log for the sync request. Stored live connections missing required scopes now fail closed before sync begins.

## Creative and Diagnosis

- `POST /api/creative-assets`
- `POST /api/creative-analysis/jobs`
- `GET /api/jobs/:id`
- `POST /api/render/jobs`
- `POST /api/placement/validate`
- `POST /api/bottleneck/jobs`
- `POST /api/performance-fusion/reports`
- `POST /api/variants/design`

`POST /api/creative-assets` is an authenticated tenant-scoped persistence route. It validates the creative asset payload before insert, normalizes `asset.type`, `width`, `height`, `durationSeconds`, and `mimeType`, persists a `creative_assets` row with optional `storagePath`, `sourceUrl`, and `checksumSha256`, and writes an audit log. Invalid or inconsistent payloads fail closed with `CREATIVE_ASSET_PAYLOAD_INVALID`.

`POST /api/placement/validate` is an authenticated tenant-scoped persistence route. It does not require approval, but it still requires tenant auth before evaluating placement compatibility or `#1487569` risk so anonymous callers cannot use internal validation APIs. On success, it saves a `placement_validation_reports` row, writes an audit log, and returns the persisted report metadata plus the validation result instead of a purely ephemeral response.

`POST /api/creative-analysis/jobs` is an authenticated tenant-scoped persistence route. It now requires `asset.id` from an already persisted same-tenant creative asset. The server rehydrates asset type, dimensions, duration, and mime type from the stored `creative_assets` row and ignores caller overrides for those fields before analysis runs. On success, it mirrors the same id into the generic `/api/jobs/:id` surface and the dedicated `creative_analysis_jobs` row, stores extracted feature blobs in `creative_features`, stores numeric score rows in `creative_component_scores`, stores `video_segments` for video assets, and writes an audit log. Requests without a persisted asset id fail closed with `CREATIVE_ASSET_ID_REQUIRED`; unknown or cross-tenant ids fail with `CREATIVE_ASSET_NOT_FOUND`.

`POST /api/bottleneck/jobs` is an authenticated tenant-scoped persistence route. It saves the diagnosis summary to `bottleneck_analysis_jobs`, expands each stage into `bottleneck_stage_scores`, derives a bounded set of weakest-stage hypotheses into `bottleneck_hypotheses`, mirrors the same id into the generic `/api/jobs/:id` surface, and writes an audit log. This keeps `performance_fusion_reports.bottleneck_job_id` referentially valid instead of pointing at an id that only existed in the generic job table.

`POST /api/performance-fusion/reports` is an authenticated tenant-scoped persistence route. It computes the fusion report, saves a `performance_fusion_reports` row, and writes an audit log instead of returning an ephemeral analysis object only. Callers may attach `assetId` and `bottleneckJobId` for traceability, but the route still preserves the report's `correlation_not_causation` language guard.

`POST /api/render/jobs` keeps deterministic final/QA render checks approval-free when no paid operation is requested. When `operationType` is `image_generation` or `video_generation`, it becomes a paid AI generation queue endpoint: callers must provide an approved same-tenant `ai_paid_generation` approval for the matching operation type. On success, the API marks that approval `executed`, records a `running` cost usage reservation linked by `relatedJobId = approval.id`, queues a `creative_jobs` worker job with server-derived cost metadata, and writes an audit log. The worker later writes the final succeeded/failed usage row for the same `relatedJobId` so cost summaries do not leave stale reservations. Missing or mismatched approval returns `PAID_OPERATION_APPROVAL_REQUIRED`; reused approvals return `APPROVAL_REQUIRED`.

`POST /api/variants/design` is treated as a paid variant batch operation. The request must include an `approvalRequestId` for an approved same-tenant `ai_paid_generation` approval whose `objectType` is `variant_batch`. On success, the API marks that approval `executed`, writes an audit log, and records a succeeded cost usage entry linked by `relatedJobId = approval.id`. Missing or mismatched approval returns `PAID_OPERATION_APPROVAL_REQUIRED`; a reused or unapproved request returns `APPROVAL_REQUIRED`.

## Draft and Approval

- `POST /api/drafts/preflight`
- `POST /api/drafts/create-paused`
- `GET /api/approvals`
- `POST /api/approvals`
- `POST /api/approvals/:id/approve`
- `POST /api/approvals/:id/reject`
- `POST /api/approvals/:id/execute`

`POST /api/drafts/preflight` is also authenticated and tenant-scoped even though it does not persist rows. The server reruns the same preflight checks used by draft creation and returns only analysis output; it never bypasses tenant auth just because the operation is read-like.

`POST /api/drafts/create-paused` reruns draft preflight on the server. If preflight is blocked, the route fails closed with `DRAFT_PREFLIGHT_BLOCKED` and includes the blocker details. Before it creates a pending approval, the route now also validates execution readiness: it requires a persisted same-tenant `asset.id`, a Meta `adAccountId`, the tenant-scoped Meta adapter resolution, and any live-only prerequisites such as asset `sourceUrl` and video `payload.thumbnailUrl`. Live drafts also require a non-empty ad set `targeting`, and objective/optimization-specific `promotedObject` fields before approval creation or execution. For example, `OFFSITE_CONVERSIONS` requires `promotedObject.pixel_id` plus a conversion event, catalog sales require `promotedObject.product_catalog_id`, and app promotion requires `promotedObject.application_id` plus `object_store_url`. In live mode the route also sends Meta `execution_options=["validate_only"]` checks before approval creation for campaign-level payloads, and again before campaign/ad set creation during execution, so provider-side validation errors surface earlier and reduce partial side effects. If any readiness or validate-only check fails, the route fails closed instead of writing a non-executable approval request. If readiness passes and no `approvalRequestId` is supplied, the route creates a pending same-tenant `meta_create_ad_paused` approval and returns `202 approval_required` with guard metadata. If an approved matching `approvalRequestId` is supplied, the route uses the same readiness checks, persists an `ad_drafts` row, and marks the approval `executed`. Local-safe mock execution calls the upload/creative/campaign/adset/ad adapter chain and stores the returned Meta ids on the draft and the approval execution result. Stored live Meta connections now execute the Graph upload/creative/campaign/adset/ad PAUSED chain server-side; the route never exposes the decrypted token and never appends it to query params. Missing readiness prerequisites fail closed with `CREATIVE_ASSET_ID_REQUIRED`, `CREATIVE_ASSET_NOT_FOUND`, `META_AD_ACCOUNT_REQUIRED`, `META_ASSET_SOURCE_URL_REQUIRED`, `META_VIDEO_THUMBNAIL_REQUIRED`, `META_TARGETING_REQUIRED`, `META_PROMOTED_OBJECT_REQUIRED`, `META_PIXEL_ID_REQUIRED`, `META_CONVERSION_EVENT_REQUIRED`, `META_PRODUCT_CATALOG_REQUIRED`, or `META_APPLICATION_ID_REQUIRED`/`META_OBJECT_STORE_URL_REQUIRED`. Provider-side validate-only failures return `META_GRAPH_REQUEST_FAILED` with sanitized Meta error details. If the live write chain partially succeeds and a later Meta step fails, the route cancels the approval, persists the partial Meta ids on `approval_requests.execution_result_json`, writes an audit log with the partial breadcrumb, and returns a sanitized partial-failure response so the same approval cannot be reused to duplicate upstream side effects. Executed approvals cannot be reused.

`GET /api/approvals` returns only the authenticated tenant's approval requests in newest-first order. Each item includes the approval and current guard metadata so approval-center clients can display typed confirmation, expiry, and second-approval requirements without recomputing policy client-side.

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

Approval execution goes through an action-specific executor registry. Generic approval execution remains available for actions such as activation, pause/delete, and disconnect, but it no longer dispatches paused-draft creation. `meta_create_ad_paused` now returns `APPROVAL_ACTION_EXECUTOR_REQUIRED` from `POST /api/approvals/:id/execute` and must instead be consumed by `POST /api/drafts/create-paused`, so draft preflight, `ad_drafts` persistence, and Meta side effects stay in the same execution path. For the remaining generic actions, local mock execution returns action-specific results such as `mock_activated_ad`, but production must not return a fake execution success; if `HERMES_APPROVAL_EXECUTION_MODE=mock` or the live executor is not configured, execution fails closed with `MOCK_EXECUTION_DISABLED_IN_PRODUCTION` or `LIVE_APPROVAL_EXECUTOR_NOT_CONFIGURED`.

Paid AI approvals are not executable through the generic approval route. `ai_paid_generation` returns `PAID_OPERATION_EXECUTOR_REQUIRED` from `POST /api/approvals/:id/execute` and must instead be consumed by the relevant domain route or worker, such as `POST /api/variants/design`, so output validation and cost usage logging happen in the same execution path.

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

`settings.providerName` is only the server lookup key. The API loads pricing, credits, and caps from the authenticated tenant's `integration_settings` row for that provider and ignores client-supplied cap/pricing overrides. If the provider row is missing or invalid, the route fails closed with `COST_SETTINGS_NOT_CONFIGURED` or `COST_SETTINGS_INVALID`.

The API creates a pending `ai_paid_generation` approval only when the estimate is inside the effective cost cap and the operation requires approval. Cap checks use server-side `cost_usage_logs` summaries, not client-supplied usage totals. Blocked estimates do not create approvals. Approval payloads store cost metadata only; executable budget mutation fields remain hard-blocked. When an approval is created, the estimate log is linked with `relatedJobId = approval.id` so a later terminal worker log can replace or close the reservation in cost summaries instead of double-counting it.

`GET /api/cost/usage` is a tenant-scoped server-policy route. Callers must supply `providerName` as a query parameter, for example `/api/cost/usage?providerName=mock-ai`. The route resolves that provider's stored tenant `integration_settings` row server-side, returns the raw usage rows plus the daily/monthly summary, and includes a `policy` block containing the resolved provider plan/caps and the computed `effectiveDailyCapKrw`. Missing `providerName` returns `COST_PROVIDER_REQUIRED`; missing or malformed stored settings return `COST_SETTINGS_NOT_CONFIGURED` or `COST_SETTINGS_INVALID`.

`POST /api/data-deletion-requests` does not immediately delete or queue tenant data deletion work. It creates a destructive `tenant_data_deletion` approval request, writes an audit record, and returns typed-confirmation guard metadata. Actual deletion execution must happen only after the two-step destructive approval flow.

## Budget Policy

No route may execute budget changes. Budget-related recommendations are allowed only as text hypotheses or human-facing suggestions.
