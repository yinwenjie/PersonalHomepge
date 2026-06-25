-- Verify Phase 1.11.6 account-managed recovery model boundary.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/006_account_managed_sync_foundation.sql
-- - supabase/migrations/013_cloud_home_snapshots.sql
--
-- This verification script is read-only.
-- It verifies the current v1 RLS and RPC permission boundary only.
-- It does not mean the frontend never touches the current user's managed secret:
-- Phase 1.11.6 deliberately keeps the existing RLS-based recovery flow.

-- 1. Account-managed recovery tables should exist with RLS enabled.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'home_space_credentials',
    'home_space_snapshots',
    'home_space_audit_events'
  )
order by tablename;

-- Expected:
-- - three rows.
-- - rowsecurity = true for all three tables.

-- 2. Frontend table grants should not expose account-managed recovery data to anon or PUBLIC.
select
  grantee,
  table_name,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'home_space_credentials',
    'home_space_snapshots',
    'home_space_audit_events'
  )
  and grantee in ('anon', 'PUBLIC')
order by table_name, grantee, privilege_type;

-- Expected:
-- - 0 rows.

-- 3. Authenticated table grants should be narrow.
select
  grantee,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'home_space_credentials',
    'home_space_snapshots',
    'home_space_audit_events'
  )
  and grantee = 'authenticated'
group by grantee, table_name
order by table_name;

-- Expected:
-- - home_space_credentials: INSERT, SELECT, UPDATE.
-- - home_space_snapshots: INSERT, SELECT.
-- - home_space_audit_events: INSERT, SELECT.

-- 4. RLS policies should restrict rows to auth.uid().
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'home_space_credentials',
    'home_space_snapshots',
    'home_space_audit_events'
  )
order by tablename, policyname;

-- Expected:
-- - home_space_credentials select/update policies use user_id = auth.uid().
-- - home_space_credentials insert/update checks require user_id = auth.uid()
--   and an account-managed home space owned by auth.uid().
-- - home_space_snapshots select uses user_id = auth.uid().
-- - home_space_snapshots insert requires user_id = auth.uid()
--   and an account-managed home space owned by auth.uid().
-- - home_space_audit_events select/insert use user_id = auth.uid().

-- 5. Quick text-based policy boundary summary.
select
  tablename,
  bool_or(coalesce(qual, '') ilike '%user_id = auth.uid()%') as has_own_user_select_or_update_filter,
  bool_or(coalesce(with_check, '') ilike '%user_id = auth.uid()%') as has_own_user_insert_or_update_check,
  bool_or(coalesce(with_check, '') ilike '%account-managed%') as insert_check_mentions_account_managed
from pg_policies
where schemaname = 'public'
  and tablename in (
    'home_space_credentials',
    'home_space_snapshots',
    'home_space_audit_events'
  )
group by tablename
order by tablename;

-- Expected:
-- - All rows have own-user filters/checks where applicable.
-- - home_space_credentials and home_space_snapshots mention account-managed in insert/update checks.

-- 6. Account-managed v2 RPCs should only be executable by authenticated.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'create_account_managed_home_space_v2',
    'migrate_sync_code_home_space_to_account_managed_v2',
    'push_account_managed_sync_space',
    'force_push_account_managed_sync_space'
  )
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by routine_name, grantee, privilege_type;

-- Expected:
-- - authenticated EXECUTE rows exist for all four functions.
-- - no anon or PUBLIC EXECUTE rows.

-- 7. Legacy account-managed RPCs should still be authenticated-only.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'create_account_managed_home_space',
    'migrate_sync_code_home_space_to_account_managed'
  )
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by routine_name, grantee, privilege_type;

-- Expected:
-- - authenticated EXECUTE rows exist.
-- - no anon or PUBLIC EXECUTE rows.

-- 8. Ordinary sync-code RPCs should remain compatible for anon and authenticated.
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
order by routine_name, grantee, privilege_type;

-- Expected:
-- - anon and authenticated can execute all ordinary sync-code RPCs.
-- - This preserves the ordinary sync-code encrypted sync boundary.

-- 9. Account-managed secret and plaintext-history columns should stay out of home_spaces.
select
  table_name,
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'home_spaces'
  and column_name in (
    'access_token',
    'accessToken',
    'encryption_key',
    'encryptionKey',
    'sync_code',
    'syncCode',
    'document_json',
    'managed_access_token',
    'managed_encryption_key'
  )
order by column_name;

-- Expected:
-- - 0 rows.

-- 10. Account-managed cloud history must store plaintext document_json only in the snapshot table.
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'home_space_credentials',
    'home_space_snapshots',
    'home_space_audit_events'
  )
  and column_name in (
    'access_token',
    'encryption_key',
    'document_json',
    'metadata',
    'summary'
  )
order by table_name, column_name;

-- Expected:
-- - home_space_credentials contains access_token and encryption_key.
-- - home_space_snapshots contains document_json and summary.
-- - home_space_audit_events contains metadata and summary fields, but not document_json.

-- 11. Optional A/B RLS simulation.
-- Replace these placeholders before running this section:
-- - 00000000-0000-0000-0000-00000000000a -> user A auth.users.id
-- - 00000000-0000-0000-0000-00000000000b -> user B auth.users.id
-- - 00000000-0000-0000-0000-0000000000b1 -> a home_spaces.id owned by user B
--
-- This block should not permanently modify data because it rolls back.
-- It verifies that user A cannot read user B managed credentials, snapshots,
-- audit rows, or snapshot document_json through normal authenticated RLS.
/*
begin;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

select 'credentials_user_b_visible_to_a' as check_name, count(*) as visible_rows
from public.home_space_credentials
where user_id = '00000000-0000-0000-0000-00000000000b'::uuid;

select 'snapshots_user_b_visible_to_a' as check_name, count(*) as visible_rows
from public.home_space_snapshots
where user_id = '00000000-0000-0000-0000-00000000000b'::uuid;

select 'snapshot_document_json_user_b_visible_to_a' as check_name, count(document_json) as visible_document_json_rows
from public.home_space_snapshots
where home_space_id = '00000000-0000-0000-0000-0000000000b1'::uuid;

select 'audit_user_b_visible_to_a' as check_name, count(*) as visible_rows
from public.home_space_audit_events
where user_id = '00000000-0000-0000-0000-00000000000b'::uuid;

rollback;
*/

-- Expected for section 11:
-- - All user B visible values are 0.
--
-- Optional negative anon checks to run separately:
-- - As role anon, direct SELECT from home_space_credentials should fail with permission denied.
-- - As role anon, direct SELECT from home_space_snapshots should fail with permission denied.
-- - As role anon, direct SELECT from home_space_audit_events should fail with permission denied.
