create type public.data_deletion_request_status_enum as enum (
  'approval_required',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);

alter table public.data_deletion_requests
  alter column status drop default;

alter table public.data_deletion_requests
  alter column status type public.data_deletion_request_status_enum
  using status::text::public.data_deletion_request_status_enum;

alter table public.data_deletion_requests
  alter column status set default 'approval_required';
