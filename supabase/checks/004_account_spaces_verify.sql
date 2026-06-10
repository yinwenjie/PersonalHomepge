-- Verify that supabase/migrations/004_account_spaces.sql has been applied.
-- Run this file in Supabase Dashboard SQL Editor.

-- 1. Account tables should exist and RLS should be enabled.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('profiles', 'account_preferences', 'home_spaces')
order by tablename;

-- Expected:
-- - account_preferences, home_spaces, profiles are returned.
-- - rowsecurity is true for all three tables.

-- 2. Own-data RLS policies should exist for authenticated users.
select
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('profiles', 'account_preferences', 'home_spaces')
order by tablename, policyname;

-- Expected:
-- - profiles: select / insert / update own.
-- - account_preferences: select / insert / update own.
-- - home_spaces: select / insert / update / delete own.
-- - roles should be {authenticated}.

-- 3. home_spaces must not store sync-code secrets.
select
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'home_spaces'
  and column_name in ('access_token', 'encryption_key', 'sync_code');

-- Expected: 0 rows.

-- 4. Account table columns.
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'account_preferences', 'home_spaces')
order by table_name, ordinal_position;

-- 5. Key constraints and foreign keys.
select
  conrelid::regclass as table_name,
  conname,
  contype,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conrelid::regclass::text in ('profiles', 'account_preferences', 'home_spaces')
order by table_name, conname;

-- 6. Frontend role table grants.
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
