create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to authenticated;

create type public.user_role_enum as enum ('owner', 'admin', 'marketer', 'analyst', 'viewer');
create type public.risk_level_enum as enum ('read', 'draft', 'publish', 'destructive', 'hard_blocked');
create type public.approval_status_enum as enum ('pending', 'approved', 'rejected', 'expired', 'executed', 'cancelled');
create type public.job_status_enum as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.asset_type_enum as enum ('image', 'video');
create type public.approval_action_enum as enum (
  'meta_upload_image',
  'meta_upload_video',
  'meta_create_creative',
  'meta_create_campaign_paused',
  'meta_create_adset_paused',
  'meta_create_ad_paused',
  'meta_activate_campaign',
  'meta_activate_adset',
  'meta_activate_ad',
  'meta_pause_ad',
  'meta_delete_ad',
  'meta_change_targeting',
  'meta_replace_creative',
  'catalog_mutation',
  'ai_paid_generation'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_internal boolean not null default false,
  cross_tenant_learning_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.user_role_enum not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create or replace function private.has_tenant_role(target_tenant_id uuid, allowed_roles public.user_role_enum[])
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.tenant_id = target_tenant_id
      and ur.user_id = (select auth.uid())
      and ur.role = any(allowed_roles)
  );
$$;

grant execute on function private.has_tenant_role(uuid, public.user_role_enum[]) to authenticated;

create table public.meta_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  provider text not null default 'meta',
  connection_mode text not null default 'oauth',
  encrypted_access_token text not null,
  token_iv text not null,
  token_auth_tag text not null,
  token_kid text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  status text not null default 'connected',
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  connection_id uuid references public.meta_connections(id) on delete set null,
  meta_ad_account_id text not null,
  name text not null,
  currency text,
  timezone_name text,
  status text,
  raw_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, meta_ad_account_id)
);

create table public.campaigns_cache (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  meta_campaign_id text not null,
  name text not null,
  objective text,
  status text,
  raw_json jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, meta_campaign_id)
);

create table public.adsets_cache (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  campaign_id uuid references public.campaigns_cache(id) on delete cascade,
  meta_adset_id text not null,
  name text not null,
  optimization_goal text,
  status text,
  targeting_json jsonb not null default '{}',
  raw_json jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, meta_adset_id)
);

create table public.ads_cache (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  adset_id uuid references public.adsets_cache(id) on delete cascade,
  meta_ad_id text not null,
  meta_creative_id text,
  name text not null,
  status text,
  raw_json jsonb not null default '{}',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, meta_ad_id)
);

create table public.insights_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  ad_account_id uuid references public.ad_accounts(id) on delete cascade,
  campaign_id uuid references public.campaigns_cache(id) on delete set null,
  adset_id uuid references public.adsets_cache(id) on delete set null,
  ad_id uuid references public.ads_cache(id) on delete set null,
  level text not null,
  date_start date,
  date_stop date,
  spend numeric(14, 2) not null default 0,
  impressions integer not null default 0,
  reach integer not null default 0,
  frequency numeric(10, 4) not null default 0,
  clicks integer not null default 0,
  link_clicks integer not null default 0,
  outbound_clicks integer not null default 0,
  landing_page_views integer not null default 0,
  add_to_cart integer not null default 0,
  purchases integer not null default 0,
  ctr numeric(10, 4) not null default 0,
  cpc numeric(14, 4) not null default 0,
  cpm numeric(14, 4) not null default 0,
  purchase_roas numeric(14, 4),
  breakdowns_json jsonb not null default '{}',
  actions_json jsonb not null default '{}',
  raw_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  asset_type public.asset_type_enum not null,
  storage_path text,
  source_url text,
  sha256 text,
  width integer,
  height integer,
  duration_seconds numeric(10, 3),
  mime_type text,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, sha256)
);

create table public.creative_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  asset_id uuid references public.creative_assets(id) on delete cascade,
  job_type text not null,
  status public.job_status_enum not null default 'queued',
  input_json jsonb not null default '{}',
  result_json jsonb not null default '{}',
  error_text text,
  worker_id text,
  attempts integer not null default 0,
  max_attempts integer not null default 2,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creative_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  asset_id uuid references public.creative_assets(id) on delete cascade,
  status public.job_status_enum not null default 'queued',
  analysis_type text not null,
  result_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creative_features (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  asset_id uuid not null references public.creative_assets(id) on delete cascade,
  feature_type text not null,
  feature_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creative_component_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  asset_id uuid not null references public.creative_assets(id) on delete cascade,
  score_name text not null,
  score_value integer not null check (score_value between 0 and 100),
  evidence_json jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.video_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  asset_id uuid not null references public.creative_assets(id) on delete cascade,
  start_seconds numeric(10, 3) not null,
  end_seconds numeric(10, 3) not null,
  segment_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bottleneck_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  insight_snapshot_id uuid references public.insights_snapshots(id) on delete cascade,
  status public.job_status_enum not null default 'queued',
  data_sufficiency text not null default 'observation',
  result_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bottleneck_stage_scores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  bottleneck_job_id uuid not null references public.bottleneck_analysis_jobs(id) on delete cascade,
  stage text not null,
  score_value integer not null check (score_value between 0 and 100),
  confidence text not null,
  evidence_json jsonb not null default '[]',
  recommendation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bottleneck_hypotheses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  bottleneck_job_id uuid references public.bottleneck_analysis_jobs(id) on delete cascade,
  hypothesis text not null,
  confidence text not null,
  evidence_json jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.performance_fusion_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  asset_id uuid references public.creative_assets(id) on delete set null,
  bottleneck_job_id uuid references public.bottleneck_analysis_jobs(id) on delete set null,
  report_json jsonb not null default '{}',
  language_guard text not null default 'correlation_not_causation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creative_hypotheses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  fusion_report_id uuid references public.performance_fusion_reports(id) on delete cascade,
  hypothesis text not null,
  changed_variable text,
  confidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creative_experiments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  hypothesis_id uuid references public.creative_hypotheses(id) on delete set null,
  control_asset_id uuid references public.creative_assets(id) on delete set null,
  design_json jsonb not null default '{}',
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creative_learning_patterns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  opt_in_confirmed boolean not null default false,
  industry text,
  product_category text,
  placement text,
  creative_type text,
  aggregate_json jsonb not null default '{}',
  anonymization_version text not null default 'v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creative_learning_patterns_no_raw_ids check (
    aggregate_json::text !~* '(ad_account_id|meta_ad_id|customer|brand|token)'
  )
);

create table public.placement_validation_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  asset_id uuid references public.creative_assets(id) on delete set null,
  placements text[] not null default '{}',
  status text not null,
  error_1487569_risk boolean not null default false,
  report_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ad_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  ad_account_id uuid references public.ad_accounts(id) on delete set null,
  asset_id uuid references public.creative_assets(id) on delete set null,
  approval_request_id uuid,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  draft_type text not null,
  meta_status text not null default 'PAUSED' check (meta_status in ('PAUSED', 'ACTIVE', 'ARCHIVED', 'DELETED')),
  preflight_json jsonb not null default '{}',
  payload_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  second_approved_by uuid references auth.users(id) on delete set null,
  action public.approval_action_enum not null,
  risk_level public.risk_level_enum not null,
  object_type text not null,
  object_id text,
  status public.approval_status_enum not null default 'pending',
  requires_second_approval boolean not null default false,
  before_json jsonb not null default '{}',
  after_json jsonb not null default '{}',
  diff_json jsonb not null default '{}',
  reason text,
  execution_result_json jsonb not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_action_no_budget check (action::text !~* '(budget|daily_budget|lifetime_budget|bid_amount|spend_cap)')
);

alter table public.ad_drafts
  add constraint ad_drafts_approval_request_fk
  foreign key (approval_request_id)
  references public.approval_requests(id)
  on delete set null;

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  object_type text not null,
  object_id text,
  approval_request_id uuid references public.approval_requests(id) on delete set null,
  before_json jsonb not null default '{}',
  after_json jsonb not null default '{}',
  ip_address inet,
  user_agent text,
  result text not null default 'recorded',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.integration_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  provider text not null,
  settings_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

create table public.cost_usage_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  provider text not null,
  model text,
  operation_type text not null,
  estimated_credits numeric(14, 4) not null default 0,
  actual_credits numeric(14, 4),
  estimated_cost_krw numeric(14, 2) not null default 0,
  actual_cost_krw numeric(14, 2),
  related_asset_id uuid references public.creative_assets(id) on delete set null,
  related_job_id uuid,
  status text not null default 'estimated',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.benchmark_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  scope text not null,
  objective text,
  optimization_goal text,
  placement text,
  profile_json jsonb not null default '{}',
  window_days integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.data_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  scope text not null default 'tenant',
  status public.job_status_enum not null default 'queued',
  result_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index user_roles_tenant_user_idx on public.user_roles (tenant_id, user_id);
create index meta_connections_tenant_idx on public.meta_connections (tenant_id);
create index ad_accounts_tenant_idx on public.ad_accounts (tenant_id);
create index insights_snapshots_tenant_level_idx on public.insights_snapshots (tenant_id, level, created_at desc);
create index creative_assets_tenant_idx on public.creative_assets (tenant_id);
create index creative_jobs_claim_idx on public.creative_jobs (status, created_at);
create index approval_requests_tenant_status_idx on public.approval_requests (tenant_id, status, created_at desc);
create index audit_logs_tenant_created_idx on public.audit_logs (tenant_id, created_at desc);
create index cost_usage_logs_tenant_created_idx on public.cost_usage_logs (tenant_id, created_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tenants',
    'users',
    'user_roles',
    'meta_connections',
    'ad_accounts',
    'campaigns_cache',
    'adsets_cache',
    'ads_cache',
    'insights_snapshots',
    'creative_assets',
    'creative_jobs',
    'creative_analysis_jobs',
    'creative_features',
    'creative_component_scores',
    'video_segments',
    'bottleneck_analysis_jobs',
    'bottleneck_stage_scores',
    'bottleneck_hypotheses',
    'performance_fusion_reports',
    'creative_hypotheses',
    'creative_experiments',
    'creative_learning_patterns',
    'placement_validation_reports',
    'ad_drafts',
    'approval_requests',
    'audit_logs',
    'integration_settings',
    'cost_usage_logs',
    'benchmark_profiles',
    'data_deletion_requests'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', table_name || '_set_updated_at', table_name);
  end loop;
end $$;

create policy users_select_self
on public.users
for select
to authenticated
using ((select auth.uid()) = id);

create policy users_update_self
on public.users
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy user_roles_select_tenant
on public.user_roles
for select
to authenticated
using (
  private.has_tenant_role(tenant_id, array['owner', 'admin', 'marketer', 'analyst', 'viewer']::public.user_role_enum[])
);

create policy user_roles_write_owner_admin
on public.user_roles
for all
to authenticated
using (
  private.has_tenant_role(tenant_id, array['owner', 'admin']::public.user_role_enum[])
)
with check (
  private.has_tenant_role(tenant_id, array['owner', 'admin']::public.user_role_enum[])
);

create policy tenants_select_members
on public.tenants
for select
to authenticated
using (
  private.has_tenant_role(id, array['owner', 'admin', 'marketer', 'analyst', 'viewer']::public.user_role_enum[])
);

create policy tenants_update_owner_admin
on public.tenants
for update
to authenticated
using (
  private.has_tenant_role(id, array['owner', 'admin']::public.user_role_enum[])
)
with check (
  private.has_tenant_role(id, array['owner', 'admin']::public.user_role_enum[])
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'meta_connections',
    'ad_accounts',
    'campaigns_cache',
    'adsets_cache',
    'ads_cache',
    'insights_snapshots',
    'creative_assets',
    'creative_jobs',
    'creative_analysis_jobs',
    'creative_features',
    'creative_component_scores',
    'video_segments',
    'bottleneck_analysis_jobs',
    'bottleneck_stage_scores',
    'bottleneck_hypotheses',
    'performance_fusion_reports',
    'creative_hypotheses',
    'creative_experiments',
    'creative_learning_patterns',
    'placement_validation_reports',
    'ad_drafts',
    'approval_requests',
    'audit_logs',
    'integration_settings',
    'cost_usage_logs',
    'benchmark_profiles',
    'data_deletion_requests'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''marketer'', ''analyst'', ''viewer'']::public.user_role_enum[]))',
      table_name || '_select_tenant',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''marketer'']::public.user_role_enum[]))',
      table_name || '_insert_tenant',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''marketer'']::public.user_role_enum[])) with check (private.has_tenant_role(tenant_id, array[''owner'', ''admin'', ''marketer'']::public.user_role_enum[]))',
      table_name || '_update_tenant',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (private.has_tenant_role(tenant_id, array[''owner'', ''admin'']::public.user_role_enum[]))',
      table_name || '_delete_tenant',
      table_name
    );
  end loop;
end $$;

create or replace function private.claim_creative_job(worker_name text)
returns public.creative_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.creative_jobs;
begin
  update public.creative_jobs
  set status = 'running',
      worker_id = worker_name,
      started_at = now(),
      attempts = attempts + 1,
      updated_at = now()
  where id = (
    select id
    from public.creative_jobs
    where status = 'queued'
      and attempts < max_attempts
    order by created_at asc
    for update skip locked
    limit 1
  )
  returning * into claimed;

  return claimed;
end;
$$;

grant execute on function private.claim_creative_job(text) to service_role;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
