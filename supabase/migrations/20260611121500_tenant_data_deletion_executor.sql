grant usage on schema private to service_role;

create or replace function private.execute_tenant_data_deletion(
  target_tenant_id uuid,
  deletion_scope text,
  deletion_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
  deleted_counts jsonb := '{}'::jsonb;
begin
  if deletion_scope not in ('tenant', 'meta_integration', 'creative_assets', 'learning_patterns') then
    raise exception 'UNSUPPORTED_DELETION_SCOPE:%', deletion_scope;
  end if;

  if deletion_scope in ('tenant', 'meta_integration') then
    update public.meta_connections
    set encrypted_access_token = '',
        token_iv = '',
        token_auth_tag = '',
        token_kid = 'deleted',
        scopes = '{}',
        expires_at = null,
        status = 'revoked',
        metadata_json = metadata_json || jsonb_build_object(
          'deletionRequestId', deletion_request_id,
          'deletionScope', deletion_scope
        ),
        updated_at = now()
    where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('metaConnectionsRevoked', deleted_count);

    delete from public.insights_snapshots where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('insightsSnapshots', deleted_count);

    delete from public.ads_cache where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('adsCache', deleted_count);

    delete from public.adsets_cache where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('adsetsCache', deleted_count);

    delete from public.campaigns_cache where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('campaignsCache', deleted_count);

    delete from public.ad_accounts where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('adAccounts', deleted_count);

    delete from public.integration_settings
    where tenant_id = target_tenant_id
      and (deletion_scope = 'tenant' or provider in ('meta', 'signal-diagnostics'));
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('integrationSettings', deleted_count);
  end if;

  if deletion_scope in ('tenant', 'creative_assets') then
    delete from public.ad_drafts where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('adDrafts', deleted_count);

    delete from public.placement_validation_reports where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('placementValidationReports', deleted_count);

    delete from public.creative_jobs where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('creativeJobs', deleted_count);

    delete from public.creative_analysis_jobs where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('creativeAnalysisJobs', deleted_count);

    delete from public.creative_features where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('creativeFeatures', deleted_count);

    delete from public.creative_component_scores where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('creativeComponentScores', deleted_count);

    delete from public.video_segments where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('videoSegments', deleted_count);

    delete from public.creative_assets where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('creativeAssets', deleted_count);
  end if;

  if deletion_scope in ('tenant', 'learning_patterns') then
    delete from public.creative_experiments where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('creativeExperiments', deleted_count);

    delete from public.creative_hypotheses where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('creativeHypotheses', deleted_count);

    delete from public.creative_learning_patterns where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('creativeLearningPatterns', deleted_count);

    delete from public.bottleneck_hypotheses where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('bottleneckHypotheses', deleted_count);

    delete from public.bottleneck_stage_scores where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('bottleneckStageScores', deleted_count);

    delete from public.performance_fusion_reports where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('performanceFusionReports', deleted_count);

    delete from public.bottleneck_analysis_jobs where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('bottleneckAnalysisJobs', deleted_count);

    delete from public.benchmark_profiles where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('benchmarkProfiles', deleted_count);
  end if;

  if deletion_scope = 'tenant' then
    delete from public.cost_usage_logs where tenant_id = target_tenant_id;
    get diagnostics deleted_count = row_count;
    deleted_counts := deleted_counts || jsonb_build_object('costUsageLogs', deleted_count);
  end if;

  return jsonb_build_object(
    'mode', 'live',
    'scope', deletion_scope,
    'deletedCounts', deleted_counts
  );
end;
$$;

grant execute on function private.execute_tenant_data_deletion(uuid, text, uuid) to service_role;
