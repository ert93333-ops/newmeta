grant usage on schema private to service_role;

create or replace function private.complete_creative_job(
  job_id uuid,
  worker_name text,
  job_result jsonb default '{}'::jsonb
)
returns public.creative_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  completed public.creative_jobs;
begin
  update public.creative_jobs
  set status = 'succeeded',
      result_json = coalesce(job_result, '{}'::jsonb),
      error_text = null,
      completed_at = now(),
      updated_at = now()
  where id = job_id
    and worker_id = worker_name
    and status = 'running'
  returning * into completed;

  return completed;
end;
$$;

create or replace function private.fail_creative_job(
  job_id uuid,
  worker_name text,
  error_message text,
  job_result jsonb default '{}'::jsonb
)
returns public.creative_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  failed public.creative_jobs;
begin
  update public.creative_jobs
  set status = case
        when attempts < max_attempts then 'queued'::public.job_status_enum
        else 'failed'::public.job_status_enum
      end,
      worker_id = case
        when attempts < max_attempts then null
        else worker_name
      end,
      started_at = case
        when attempts < max_attempts then null
        else started_at
      end,
      completed_at = case
        when attempts < max_attempts then null
        else now()
      end,
      error_text = left(coalesce(error_message, 'worker execution failed'), 2000),
      result_json = coalesce(job_result, result_json),
      updated_at = now()
  where id = job_id
    and worker_id = worker_name
    and status = 'running'
  returning * into failed;

  return failed;
end;
$$;

grant execute on function private.complete_creative_job(uuid, text, jsonb) to service_role;
grant execute on function private.fail_creative_job(uuid, text, text, jsonb) to service_role;
