# Cost Guard

Cost settings are not hardcoded. Store provider costs in `integration_settings` and usage in `cost_usage_logs`.

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

Variant design execution must be bound to an approved `ai_paid_generation` approval request with `objectType = "variant_batch"`. The approval is consumed by marking it `executed`, so the same approval cannot be reused for duplicate paid batches.

The generic approval execution route does not execute `ai_paid_generation`. Paid generation approvals must be consumed by their domain route or worker so generation output, validation, audit logging, and cost usage logging cannot drift apart.

`POST /api/cost/estimate` can create the required pending `ai_paid_generation` request when callers explicitly pass `approvalRequest.create = true`. This happens only for `approval_required` decisions; `blocked` cost decisions never create an approval request.

Daily and monthly cost cap checks use tenant-scoped server-side `cost_usage_logs` summaries. Client-supplied `todayActualCostKrw` and `monthActualCostKrw` values are ignored at the API boundary so callers cannot lower their effective usage by editing the request body.

Paid approval estimates and execution results share `relatedJobId = approval.id`. Summary calculations count the final succeeded/actual-cost row once when it exists; otherwise the estimate remains counted as a reservation.

Automatic retry is limited to one failed generation retry.
