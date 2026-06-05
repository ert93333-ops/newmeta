# Cost Guard

Cost settings are not hardcoded. Store provider costs in `integration_settings` and usage in `cost_usage_logs`.

`POST /api/cost/estimate` must resolve those settings server-side from the authenticated tenant's `integration_settings` row keyed by `settings.providerName`. Client payloads may identify the provider, units, and operation, but they must not be able to override stored caps or pricing. If the provider row is absent or malformed, the route fails closed.

Settings:

- provider name
- plan name
- monthly price
- monthly credits
- model credit costs
- image/video/analysis credit costs
- daily and monthly caps
- exchange rate
- reference daily ad budget

Default policy for a 50,000원/day ad budget:

- default AI cap: 5,000원/day
- hard cap: 7,500원/day
- effective cap: `min(user cap, hard cap, reference ad budget * 10%)`

Approval required:

- image generation
- video generation
- variant batches
- external provider credit spend

Image and video generation queueing must be bound to an approved `ai_paid_generation` approval request with a matching `objectType` of `image_generation` or `video_generation`. The render job API consumes the approval, queues a worker job, and records a `running` cost usage reservation linked by `relatedJobId = approval.id`.

The worker closes that reservation only when the queued paid generation reaches a terminal state. A succeeded job writes a final `succeeded` usage row with actual cost; an exhausted failed job writes a final `failed` row with zero actual cost. Requeued retry attempts do not close the reservation.

Variant design execution must be bound to an approved `ai_paid_generation` approval request with `objectType = "variant_batch"`. The approval is consumed by marking it `executed`, so the same approval cannot be reused for duplicate paid batches.

The generic approval execution route does not execute `ai_paid_generation`. Paid generation approvals must be consumed by their domain route or worker so generation output, validation, audit logging, and cost usage logging cannot drift apart.

`POST /api/cost/estimate` can create the required pending `ai_paid_generation` request when callers explicitly pass `approvalRequest.create = true`. This happens only for `approval_required` decisions; `blocked` cost decisions never create an approval request.

Daily and monthly cost cap checks use tenant-scoped server-side `cost_usage_logs` summaries. Client-supplied `todayActualCostKrw`, `monthActualCostKrw`, cap values, and provider pricing values are ignored at the API boundary so callers cannot lower their effective usage or underquote a paid approval by editing the request body.

`GET /api/cost/usage` follows the same rule. It requires a `providerName` query parameter, resolves that provider's stored tenant settings server-side, and returns the computed `effectiveDailyCapKrw` from those settings instead of hardcoded policy values.

Paid approval estimates and execution results share `relatedJobId = approval.id`. Summary calculations count the final succeeded/actual-cost row once when it exists, remove the reservation when a final failed/cancelled row exists, and otherwise keep the estimate or running row counted as a reservation.

Automatic retry is limited to one failed generation retry.
