-- Verify Phase 1.5.6 account security and home-space activation state.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/004_account_spaces.sql
-- - supabase/migrations/005_account_space_activation.sql
--
-- The optional impersonation checks near the end require replacing UUID placeholders.
-- Do not paste a full sync code into SQL Editor.

-- 1. RLS should be enabled on all account and sync tables.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'account_preferences', 'home_spaces', 'sync_spaces')
order by tablename;

-- Expected:
-- - account_preferences, home_spaces, profiles, sync_spaces are returned.
-- - rowsecurity is true for all returned tables.

-- 2. Account table grants should be narrow.
select
  grantee,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('profiles', 'account_preferences', 'home_spaces')
  and grantee in ('anon', 'authenticated')
group by grantee, table_name
order by grantee, table_name;

-- Expected:
-- - authenticated | account_preferences | INSERT, SELECT, UPDATE
-- - authenticated | home_spaces         | DELETE, INSERT, SELECT, UPDATE
-- - authenticated | profiles            | INSERT, SELECT, UPDATE
-- - no anon rows for these tables.

-- 3. sync_spaces should not be directly readable or writable by frontend roles.
select
  grantee,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'sync_spaces'
  and grantee in ('anon', 'authenticated')
group by grantee, table_name
order by grantee, table_name;

-- Expected: 0 rows. Sync access should go through RPC only.

-- 4. home_spaces must not store sync-code secrets.
select
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'home_spaces'
  and column_name in ('access_token', 'encryption_key', 'sync_code');

-- Expected: 0 rows.

-- 5. Account RLS policies should include own-data checks and default-space ownership checks.
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'account_preferences', 'home_spaces')
order by tablename, policyname;

-- Expected:
-- - profiles: select / insert / update own.
-- - account_preferences: select own, insert own, update own.
-- - account_preferences insert/update with_check should reject default_space_id owned by another user.
-- - home_spaces: select / insert / update / delete own.

-- 6. activate_home_space RPC should only be executable by authenticated.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name = 'activate_home_space'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by grantee, privilege_type;

-- Expected:
-- - authenticated | EXECUTE
-- - no anon or PUBLIC EXECUTE row.

-- 7. sync-code RPCs remain available to anon and authenticated.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'create_sync_space',
    'pull_sync_space',
    'check_sync_space_revision',
    'push_sync_space',
    'force_push_sync_space',
    'revoke_sync_space'
  )
  and grantee in ('anon', 'authenticated')
order by routine_name, grantee;

-- Expected:
-- - anon and authenticated can execute the sync-code RPCs above.
-- - Direct table access to sync_spaces should still be denied by section 3.

-- 8. Default-space metadata should be internally consistent.
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

-- Expected: 0 rows.

select
  hs.user_id,
  count(*) as default_home_space_count
from public.home_spaces hs
where hs.is_default
group by hs.user_id
having count(*) > 1;

-- Expected: 0 rows.

-- 9. Optional A/B RLS simulation.
-- Replace these placeholders before running this section:
-- - 00000000-0000-0000-0000-00000000000a -> user A auth.users.id
-- - 00000000-0000-0000-0000-00000000000b -> user B auth.users.id
-- - 00000000-0000-0000-0000-0000000000a1 -> a home_spaces.id owned by user A
-- - 00000000-0000-0000-0000-0000000000b1 -> a home_spaces.id owned by user B
--
-- This block should not permanently modify data because it rolls back.
-- It verifies that user A cannot see/update/delete user B rows.
/*
begin;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

select 'profiles_user_b_visible_to_a' as check_name, count(*) as visible_rows
from public.profiles
where id = '00000000-0000-0000-0000-00000000000b'::uuid;

select 'preferences_user_b_visible_to_a' as check_name, count(*) as visible_rows
from public.account_preferences
where user_id = '00000000-0000-0000-0000-00000000000b'::uuid;

select 'home_spaces_user_b_visible_to_a' as check_name, count(*) as visible_rows
from public.home_spaces
where user_id = '00000000-0000-0000-0000-00000000000b'::uuid;

update public.home_spaces
set name = name
where id = '00000000-0000-0000-0000-0000000000b1'::uuid
returning 'updated_user_b_space_as_user_a' as check_name, id;

delete from public.home_spaces
where id = '00000000-0000-0000-0000-0000000000b1'::uuid
returning 'deleted_user_b_space_as_user_a' as check_name, id;

select public.activate_home_space('00000000-0000-0000-0000-0000000000a1'::uuid) as own_activation_expected_success;

rollback;
*/

-- Expected for section 9:
-- - The three visible_rows values for user B are 0.
-- - The update/delete returning clauses return 0 rows.
-- - activate_home_space succeeds for user A's own home space.
--
-- Optional negative checks to run separately after replacing placeholders:
-- - As user A, this should fail with "Home space not found for current account":
--   select public.activate_home_space('00000000-0000-0000-0000-0000000000b1'::uuid);
-- - As user A, this should fail RLS because user B owns the default_space_id:
--   update public.account_preferences
--   set default_space_id = '00000000-0000-0000-0000-0000000000b1'::uuid
--   where user_id = '00000000-0000-0000-0000-00000000000a'::uuid;
