-- Verify Phase 1.6.4 home-space CRUD helpers.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/009_home_space_crud.sql
--
-- The default sections are read-only.
-- The optional functional block near the end rolls back all changes.

-- 1. Home-space CRUD RPCs should exist with the expected signatures.
select
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'rename_home_space',
    'set_default_home_space',
    'remove_home_space_from_account'
  )
order by p.proname;

-- Expected:
-- - rename_home_space(p_home_space_id uuid, p_name text)
-- - set_default_home_space(p_home_space_id uuid)
-- - remove_home_space_from_account(p_home_space_id uuid)

-- 2. CRUD RPCs should only be executable by authenticated.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'rename_home_space',
    'set_default_home_space',
    'remove_home_space_from_account'
  )
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by routine_name, grantee, privilege_type;

-- Expected:
-- - each routine has authenticated | EXECUTE.
-- - no anon or PUBLIC EXECUTE rows.

-- 3. CRUD RPC source should not delete, revoke, or mutate sync_spaces.
select
  p.proname as function_name,
  case
    when p.prosrc ilike '%public.sync_spaces%'
      or p.prosrc ilike '%update%sync_spaces%'
      or p.prosrc ilike '%delete%sync_spaces%'
      or p.prosrc ilike '%revoked_at%'
    then 'review_required'
    else 'ok'
  end as sync_space_mutation_check
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'rename_home_space',
    'set_default_home_space',
    'remove_home_space_from_account'
  )
order by p.proname;

-- Expected: ok for all three functions.

-- 4. Account-side cascading behavior should remain explicit.
select
  conname as constraint_name,
  confdeltype as delete_action
from pg_constraint
where conrelid in (
    'public.account_preferences'::regclass,
    'public.home_space_credentials'::regclass
  )
  and confrelid = 'public.home_spaces'::regclass
order by conname;

-- Expected:
-- - account_preferences_default_space_fk delete_action = n (set null).
-- - home_space_credentials_home_space_fk delete_action = c (cascade).

-- 5. Default-space metadata should be internally consistent.
select
  ap.user_id,
  ap.default_space_id,
  hs.id as home_space_id,
  hs.user_id as home_space_user_id,
  hs.is_default
from public.account_preferences ap
left join public.home_spaces hs on hs.id = ap.default_space_id
where ap.default_space_id is not null
  and (
    hs.id is null
    or hs.user_id <> ap.user_id
    or hs.is_default is distinct from true
  );

select
  hs.user_id,
  count(*) as default_home_space_count
from public.home_spaces hs
where hs.is_default
group by hs.user_id
having count(*) > 1;

-- Expected:
-- - both queries return 0 rows.

-- 6. Account-managed spaces should still have at most one active managed credential.
select
  home_space_id,
  count(*) as active_credential_count
from public.home_space_credentials
where revoked_at is null
  and credential_type = 'sync-space-v1'
group by home_space_id
having count(*) > 1;

-- Expected: 0 rows.

-- 7. Optional functional rollback test.
-- Replace these placeholders before running this section:
-- - 00000000-0000-0000-0000-00000000000a -> user A auth.users.id
-- - 00000000-0000-0000-0000-00000000000b -> user B auth.users.id
-- - 00000000-0000-0000-0000-0000000000a1 -> a home_spaces.id owned by user A
-- - 00000000-0000-0000-0000-0000000000b1 -> a home_spaces.id owned by user B
--
-- This block should not permanently modify data because it rolls back.
/*
begin;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

select public.rename_home_space(
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'Phase 1.6.4 rollback test'
) as own_rename_expected_success;

select public.set_default_home_space(
  '00000000-0000-0000-0000-0000000000a1'::uuid
) as own_default_expected_success;

select
  'user_b_home_space_visible_to_a' as check_name,
  count(*) as visible_rows
from public.home_spaces
where id = '00000000-0000-0000-0000-0000000000b1'::uuid;

select public.remove_home_space_from_account(
  '00000000-0000-0000-0000-0000000000a1'::uuid
) as own_remove_expected_success;

rollback;
*/

-- Expected for section 7:
-- - rename/default/remove succeed for user A's own home space.
-- - visible_rows for user B's home space is 0.
--
-- Optional negative checks to run separately after replacing placeholders:
-- - As user A, these should fail with "Home space not found for current account":
--   select public.rename_home_space('00000000-0000-0000-0000-0000000000b1'::uuid, 'bad');
--   select public.set_default_home_space('00000000-0000-0000-0000-0000000000b1'::uuid);
--   select public.remove_home_space_from_account('00000000-0000-0000-0000-0000000000b1'::uuid);
