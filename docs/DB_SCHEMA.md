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

All tenant-scoped tables have `tenant_id`, timestamps, and RLS. `approval_action_enum` deliberately has no budget mutation action.

`audit_logs` includes `ip_address` and `user_agent` for request metadata when headers are available.

## Token Storage

`meta_connections` stores encrypted token material:

- `encrypted_access_token`
- `token_iv`
- `token_auth_tag`
- `token_kid`
- `scopes`
- `expires_at`

The encryption key is server-only and configured as `TOKEN_ENCRYPTION_KEY`.
