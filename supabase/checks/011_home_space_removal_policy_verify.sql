-- Verify Phase 1.6.4a home-space removal policy.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/009_home_space_crud.sql
--
-- This check documents and verifies the intended delete semantics:
-- - "remove from account" deletes only account-side home_spaces metadata.
-- - account-managed credentials cascade with the home_spaces row.
-- - sync_spaces rows are not deleted, revoked, or mutated by the removal RPC.

-- 1. Removal RPC should exist and remain scoped to authenticated users.
select
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'remove_home_space_from_account';

select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name = 'remove_home_space_from_account'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by grantee, privilege_type;

-- Expected:
-- - one function row for remove_home_space_from_account(p_home_space_id uuid).
-- - authenticated | EXECUTE.
-- - no anon or PUBLIC EXECUTE row.

-- 2. Removal RPC source must not reference sync_spaces or revoked_at.
select
  case
    when p.prosrc ilike '%sync_spaces%'
      or p.prosrc ilike '%revoked_at%'
      or p.prosrc ilike '%document_ciphertext%'
      or p.prosrc ilike '%document_iv%'
      or p.prosrc ilike '%document_salt%'
    then 'review_required'
    else 'ok'
  end as removal_rpc_sync_space_mutation_check
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'remove_home_space_from_account';

-- Expected: ok.

-- 3. home_spaces should restrict sync_spaces deletion and cascade only account credentials.
select
  conrelid::regclass as child_table,
  conname as constraint_name,
  confrelid::regclass as parent_table,
  confdeltype as delete_action
from pg_constraint
where conrelid in (
    'public.home_spaces'::regclass,
    'public.account_preferences'::regclass,
    'public.home_space_credentials'::regclass
  )
  and confrelid in (
    'public.sync_spaces'::regclass,
    'public.home_spaces'::regclass
  )
order by child_table::text, constraint_name;

-- Expected:
-- - home_spaces -> sync_spaces delete_action = r or a (restrict/no action).
-- - account_preferences -> home_spaces delete_action = n (set null).
-- - home_space_credentials -> home_spaces delete_action = c (cascade).

-- 4. sync_spaces should remain unavailable for direct frontend table access.
select
  grantee,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'sync_spaces'
  and grantee in ('anon', 'authenticated')
group by grantee, table_name
order by grantee;

-- Expected: 0 rows.

-- 5. Account-managed rows should not have orphaned active credentials.
select
  c.id,
  c.home_space_id,
  c.user_id
from public.home_space_credentials c
left join public.home_spaces hs
  on hs.id = c.home_space_id
 and hs.user_id = c.user_id
where c.revoked_at is null
  and hs.id is null;

-- Expected: 0 rows.

-- 6. Optional functional rollback test for removal semantics.
-- Replace these placeholders before running this section:
-- - 00000000-0000-0000-0000-00000000000a -> user A auth.users.id
-- - 00000000-0000-0000-0000-0000000000a1 -> a non-current home_spaces.id owned by user A
--
-- Prefer using a disposable test home space. This block rolls back, but it will
-- temporarily remove the selected account-side row inside the transaction.
/*
begin;

create temp table removal_policy_before as
select
  hs.id as home_space_id,
  hs.sync_space_id,
  ss.revision,
  ss.updated_at,
  ss.revoked_at,
  ss.document_ciphertext,
  count(c.id) filter (where c.revoked_at is null) as active_credential_count
from public.home_spaces hs
join public.sync_spaces ss on ss.id = hs.sync_space_id
left join public.home_space_credentials c on c.home_space_id = hs.id
where hs.id = '00000000-0000-0000-0000-0000000000a1'::uuid
group by hs.id, hs.sync_space_id, ss.revision, ss.updated_at, ss.revoked_at, ss.document_ciphertext;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

select public.remove_home_space_from_account(
  '00000000-0000-0000-0000-0000000000a1'::uuid
) as own_remove_expected_success;

reset role;

select
  'home_space_removed_inside_transaction' as check_name,
  count(*) as remaining_rows
from public.home_spaces
where id = '00000000-0000-0000-0000-0000000000a1'::uuid;

select
  'sync_space_unchanged_inside_transaction' as check_name,
  count(*) as unchanged_rows
from removal_policy_before before_row
join public.sync_spaces ss on ss.id = before_row.sync_space_id
where ss.revision = before_row.revision
  and ss.updated_at = before_row.updated_at
  and ss.revoked_at is not distinct from before_row.revoked_at
  and ss.document_ciphertext = before_row.document_ciphertext;

select
  'active_credentials_removed_inside_transaction' as check_name,
  count(*) as remaining_active_credentials
from public.home_space_credentials
where home_space_id = '00000000-0000-0000-0000-0000000000a1'::uuid
  and revoked_at is null;

rollback;
*/

-- Expected for section 6:
-- - home_space_removed_inside_transaction remaining_rows = 0.
-- - sync_space_unchanged_inside_transaction unchanged_rows = 1.
-- - active_credentials_removed_inside_transaction remaining_active_credentials = 0.
