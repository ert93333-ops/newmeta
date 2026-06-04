create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop policy if exists user_roles_write_owner_admin on public.user_roles;

create policy user_roles_insert_owner_admin
on public.user_roles
for insert
to authenticated
with check (
  private.has_tenant_role(tenant_id, array['owner', 'admin']::public.user_role_enum[])
);

create policy user_roles_update_owner_admin
on public.user_roles
for update
to authenticated
using (
  private.has_tenant_role(tenant_id, array['owner', 'admin']::public.user_role_enum[])
)
with check (
  private.has_tenant_role(tenant_id, array['owner', 'admin']::public.user_role_enum[])
);

create policy user_roles_delete_owner_admin
on public.user_roles
for delete
to authenticated
using (
  private.has_tenant_role(tenant_id, array['owner', 'admin']::public.user_role_enum[])
);
