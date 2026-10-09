begin;

-- Phase 1.18.3: authoritative exact email lookup for admin-read resolve-user.
-- public.profiles.email is editable by its owner, so administrators resolve an
-- email against auth.users instead. Only the service role (the admin-read Edge
-- Function) may call this; it returns user ids only, never other Auth fields.

create or replace function public.admin_find_auth_user_ids_by_email(p_email text)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users as u
  where p_email is not null
    and char_length(p_email) between 3 and 320
    and p_email = lower(btrim(p_email))
    and lower(u.email) = p_email
  order by u.created_at, u.id
  limit 20;
$$;

revoke all on function public.admin_find_auth_user_ids_by_email(text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_find_auth_user_ids_by_email(text) to service_role;

commit;
