-- Verify Phase 1.11.5 cloud home snapshots.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/013_cloud_home_snapshots.sql

-- 1. Cloud snapshot and audit tables should exist with RLS enabled.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('home_space_snapshots', 'home_space_audit_events')
order by tablename;

-- Expected:
-- - two rows.
-- - rowsecurity = true for both tables.

-- 2. Core columns should exist.
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('home_space_snapshots', 'home_space_audit_events')
  and column_name in (
    'document_json',
    'summary',
    'content_fingerprint',
    'snapshot_source',
    'event_type',
    'severity',
    'snapshot_id',
    'summary_before',
    'summary_after',
    'client_device_id',
    'operation_id'
  )
order by table_name, column_name;

-- Expected:
-- - home_space_snapshots includes document_json, summary, content_fingerprint, snapshot_source, client_device_id, operation_id.
-- - home_space_audit_events includes summary_before, summary_after, event_type, severity, snapshot_id, client_device_id.

-- 3. Frontend roles should not expose these tables to anon.
select
  grantee,
  table_name,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('home_space_snapshots', 'home_space_audit_events')
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by table_name, grantee, privilege_type;

-- Expected:
-- - no anon or PUBLIC rows.
-- - authenticated has SELECT and INSERT only.

-- 4. RLS policies should restrict rows to the owning user.
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('home_space_snapshots', 'home_space_audit_events')
order by tablename, policyname;

-- Expected:
-- - snapshot select policy uses user_id = auth.uid().
-- - snapshot insert policy requires user_id = auth.uid() and an account-managed home space.
-- - audit select/insert policies use user_id = auth.uid().

-- 5. New account-managed RPCs should exist and only authenticated can execute them.
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
order by routine_name, grantee;

-- Expected:
-- - authenticated EXECUTE rows exist for all four functions.
-- - no anon or PUBLIC EXECUTE rows.

-- 6. Existing sync-code RPCs should still exist.
select
  routine_name
from information_schema.routines
where specific_schema = 'public'
  and routine_name in (
    'create_sync_space',
    'pull_sync_space',
    'check_sync_space_revision',
    'push_sync_space',
    'force_push_sync_space',
    'revoke_sync_space'
  )
order by routine_name;

-- Expected:
-- - all existing sync-code RPCs are present.

-- 7. Snapshot constraints should prevent non-user-data snapshots.
select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.home_space_snapshots'::regclass
  and conname in (
    'home_space_snapshots_source_valid',
    'home_space_snapshots_document_class_user_data',
    'home_space_snapshots_document_json_object',
    'home_space_snapshots_content_fingerprint_not_empty'
  )
order by conname;

-- Expected:
-- - source is limited to account-managed-created, cloud-baseline, after-cloud-push, after-cloud-force-push.
-- - document_class is user-data.
-- - document_json must be a JSON object.

-- 8. Optional A/B RLS simulation.
-- Replace these placeholders before running this section:
-- - 00000000-0000-0000-0000-00000000000a -> user A auth.users.id
-- - 00000000-0000-0000-0000-00000000000b -> user B auth.users.id
-- - 00000000-0000-0000-0000-0000000000a1 -> a home_spaces.id owned by user A
-- - 00000000-0000-0000-0000-0000000000b1 -> a home_spaces.id owned by user B
--
-- This block should not permanently modify data because it rolls back.
-- It verifies that user A cannot read user B cloud snapshots, audit rows, or document_json.
/*
begin;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

select 'snapshots_user_b_visible_to_a' as check_name, count(*) as visible_rows
from public.home_space_snapshots
where user_id = '00000000-0000-0000-0000-00000000000b'::uuid;

select 'snapshot_document_json_user_b_visible_to_a' as check_name, count(document_json) as visible_document_json_rows
from public.home_space_snapshots
where home_space_id = '00000000-0000-0000-0000-0000000000b1'::uuid;

select 'audit_user_b_visible_to_a' as check_name, count(*) as visible_rows
from public.home_space_audit_events
where user_id = '00000000-0000-0000-0000-00000000000b'::uuid;

select 'snapshots_user_a_visible_to_a' as check_name, count(*) as visible_rows
from public.home_space_snapshots
where home_space_id = '00000000-0000-0000-0000-0000000000a1'::uuid;

rollback;
*/

-- Expected for section 8:
-- - The three user B visible values are 0.
-- - The user A count may be 0 or more depending on existing snapshots.
--
-- Optional negative anon checks to run separately:
-- - As role anon, direct SELECT from home_space_snapshots should fail with permission denied.
-- - As role anon, direct SELECT from home_space_audit_events should fail with permission denied.
