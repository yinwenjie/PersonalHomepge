-- Verify Phase 1.6.0 account-managed sync foundation.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/001_sync_spaces.sql
-- - supabase/migrations/002_revision_limit_and_check.sql
-- - supabase/migrations/003_revision_limit_999.sql
-- - supabase/migrations/004_account_spaces.sql
-- - supabase/migrations/005_account_space_activation.sql
-- - supabase/migrations/006_account_managed_sync_foundation.sql
--
-- This verification script is read-only.
-- Do not paste a full sync code into SQL Editor.

-- 1. Required Phase 1.6.0 columns should exist.
select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'home_spaces' and column_name in ('access_mode'))
    or (
      table_name = 'home_space_credentials'
      and column_name in (
        'id',
        'home_space_id',
        'user_id',
        'credential_type',
        'access_token',
        'encryption_key',
        'created_at',
        'updated_at',
        'revoked_at'
      )
    )
  )
order by table_name, ordinal_position;

-- Expected:
-- - home_spaces.access_mode exists, is not nullable, defaults to 'sync-code'.
-- - home_space_credentials contains all listed credential metadata and secret columns.

-- 2. Required constraints should exist.
select
  rel.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as constraint_definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname in ('home_spaces', 'home_space_credentials')
  and con.conname in (
    'home_spaces_access_mode_valid',
    'home_spaces_id_user_id_unique',
    'home_space_credentials_home_space_fk',
    'home_space_credentials_credential_type_valid',
    'home_space_credentials_access_token_size',
    'home_space_credentials_encryption_key_size'
  )
order by rel.relname, con.conname;

-- Expected:
-- - home_spaces_access_mode_valid allows sync-code, account-managed, password-protected.
-- - home_spaces_id_user_id_unique exists for credential ownership FK.
-- - home_space_credentials_home_space_fk references home_spaces(id, user_id).
-- - token and encryption key Base64URL shape checks exist.

-- 3. RLS should be enabled on account-managed credential table.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'account_preferences', 'home_spaces', 'home_space_credentials', 'sync_spaces')
order by tablename;

-- Expected:
-- - all returned tables have rowsecurity = true.

-- 4. Account-managed credential grants should be narrow.
select
  grantee,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'home_space_credentials'
  and grantee in ('anon', 'authenticated')
group by grantee, table_name
order by grantee, table_name;

-- Expected:
-- - authenticated | home_space_credentials | INSERT, SELECT, UPDATE
-- - no anon row.

-- 5. sync_spaces should remain unavailable for direct frontend table access.
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

-- Expected: 0 rows. Sync access should still go through RPC only.

-- 6. RLS policies should cover home spaces and credentials.
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('home_spaces', 'home_space_credentials')
order by tablename, policyname;

-- Expected:
-- - home_spaces insert/update with_check includes access_mode in ('sync-code', 'account-managed').
-- - home_space_credentials select/insert/update policies require user_id = auth.uid().
-- - credential insert/update policies also verify the home space belongs to auth.uid()
--   and has access_mode = 'account-managed'.

-- 7. home_spaces must still not store sync-code or managed credential secrets.
select
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'home_spaces'
  and column_name in ('access_token', 'encryption_key', 'sync_code', 'managed_access_token', 'managed_encryption_key');

-- Expected: 0 rows.

-- 8. create_account_managed_home_space RPC should only be executable by authenticated.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name = 'create_account_managed_home_space'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by grantee, privilege_type;

-- Expected:
-- - authenticated | EXECUTE
-- - no anon or PUBLIC EXECUTE row.

-- 9. Existing sync-code RPCs should remain available to anon and authenticated.
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

-- 10. Existing home spaces should be classified.
select
  access_mode,
  count(*) as home_space_count
from public.home_spaces
group by access_mode
order by access_mode;

-- Expected:
-- - Existing rows should usually be access_mode = 'sync-code'.
-- - account-managed rows should only appear after future Phase 1.6.1+ flows create them.

-- 11. Credential ownership metadata should be internally consistent.
select
  c.id,
  c.home_space_id,
  c.user_id as credential_user_id,
  hs.user_id as home_space_user_id,
  hs.access_mode
from public.home_space_credentials c
left join public.home_spaces hs on hs.id = c.home_space_id
where hs.id is null
  or hs.user_id <> c.user_id
  or hs.access_mode <> 'account-managed';

-- Expected: 0 rows.

-- 12. There should be at most one active sync-space-v1 managed credential per home space.
select
  home_space_id,
  count(*) as active_credential_count
from public.home_space_credentials
where revoked_at is null
  and credential_type = 'sync-space-v1'
group by home_space_id
having count(*) > 1;

-- Expected: 0 rows.
