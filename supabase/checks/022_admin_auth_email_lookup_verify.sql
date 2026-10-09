-- Verify Phase 1.18.3 Auth email lookup for admin-read.
-- Run after supabase/migrations/020_admin_auth_email_lookup.sql.
--
-- Section 1 is read-only. Section 2 creates two synthetic Auth users inside one
-- transaction and always rolls back. Do not use production emails here.

-- 1. The function must be security definer, pin search_path and be callable only
--    by service_role.
select
  p.prosecdef as security_definer,
  p.proconfig as config,
  coalesce((
    select string_agg(g.grantee, ', ' order by g.grantee)
    from information_schema.role_routine_grants g
    where g.routine_schema = 'public'
      and g.routine_name = 'admin_find_auth_user_ids_by_email'
      and g.privilege_type = 'EXECUTE'
      and g.grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ), '') as execute_grantees
from pg_proc p
where p.oid = 'public.admin_find_auth_user_ids_by_email(text)'::regprocedure;

-- Expected:
-- - exactly one row.
-- - security_definer = true.
-- - config contains search_path="".
-- - execute_grantees = service_role.

-- 2. Transaction-scoped check: an edited profile email must not resolve.
begin;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000001191', 'authenticated', 'authenticated',
   'phase-1-18-lookup-a@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000001192', 'authenticated', 'authenticated',
   'phase-1-18-lookup-b@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

update public.profiles
set email = 'phase-1-18-lookup-a@example.invalid'
where id = '00000000-0000-0000-0000-000000001192';

set local role service_role;

do $$
declare
  v_ids uuid[];
begin
  select array_agg(user_id order by user_id)
  into v_ids
  from public.admin_find_auth_user_ids_by_email('phase-1-18-lookup-a@example.invalid');

  if v_ids is distinct from array['00000000-0000-0000-0000-000000001191'::uuid] then
    raise exception 'Auth email lookup returned unexpected ids: %', v_ids;
  end if;
end;
$$;

reset role;

select 'admin auth email lookup verified' as result;

rollback;

-- Expected:
-- - the final select returns one row before the rollback.
-- - no synthetic users remain afterwards.
