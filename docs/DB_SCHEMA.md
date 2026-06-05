# DB Schema

The Supabase migration creates the foundation schema:

- Identity/RBAC: `tenants`, `users`, `user_roles`
- Meta/integrations: `meta_connections`, `ad_accounts`, `integration_settings`
- Cached Meta data: `campaigns_cache`, `adsets_cache`, `ads_cache`, `insights_snapshots`
- Creative pipeline: `creative_assets`, `creative_jobs`, `creative_analysis_jobs`, `creative_features`, `creative_component_scores`, `video_segments`
- Diagnosis/fusion: `bottleneck_analysis_jobs`, `bottleneck_stage_scores`, `bottleneck_hypotheses`, `performance_fusion_reports`, `benchmark_profiles`
- Experiments/learning: `creative_hypotheses`, `creative_experiments`, `creative_learning_patterns`
- Validation/drafts/approval: `placement_validation_reports`, `ad_drafts`, `approval_requests`, `audit_logs`
- Cost/ops: `cost_usage_logs`, `data_deletion_requests`

All tenant-scoped tables have `tenant_id`, timestamps, and RLS. `approval_action_enum` includes destructive Meta disconnect and tenant data deletion requests, but deliberately has no budget mutation action.

`audit_logs` includes `ip_address` and `user_agent` for request metadata when headers are available.

`approval_requests.execution_result_json` stores the server-side executor result after an approved action is executed.

`data_deletion_requests.status` uses a dedicated `data_deletion_request_status_enum`, so a new deletion request can be stored as `approval_required` before any queueable executor exists.

`approval_requests.expires_at` is enforced by application policy: draft 24 hours, publish 4 hours, destructive 1 hour.

`creative_jobs` worker execution is advanced through private DB functions only: claim, complete, and fail/retry. Failed jobs are requeued while `attempts < max_attempts`; the default gives one retry.

## Token Storage

`meta_connections` stores encrypted token material:

- `encrypted_access_token`
- `token_iv`
- `token_auth_tag`
- `token_kid`
- `scopes`
- `expires_at`

The encryption key is server-only and configured as `TOKEN_ENCRYPTION_KEY`.
