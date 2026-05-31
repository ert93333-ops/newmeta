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

Automatic retry is limited to one failed generation retry.
