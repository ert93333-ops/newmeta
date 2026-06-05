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

`POST /api/cost/estimate` can create the required pending `ai_paid_generation` request when callers explicitly pass `approvalRequest.create = true`. This happens only for `approval_required` decisions; `blocked` cost decisions never create an approval request.

Automatic retry is limited to one failed generation retry.
