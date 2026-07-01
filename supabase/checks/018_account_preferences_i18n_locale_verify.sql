-- Verify Phase 1.15.0 i18n locale preference model.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/016_account_preferences_i18n_locale.sql
--
-- This verification script is read-only.

-- 1. account_preferences.locale should still exist and default to zh-CN.
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'account_preferences'
  and column_name = 'locale';

-- Expected:
-- - locale text not null default 'zh-CN'

-- 2. Locale check constraint should allow system and all v1 locales.
select
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where conrelid = 'public.account_preferences'::regclass
  and conname = 'account_preferences_locale_allowed';

-- Expected:
-- - one row.
-- - allowed values include system, zh-CN, zh-TW, en-US, fr-FR, es-ES, ja-JP, ko-KR, it-IT.

-- 3. Existing rows should all have valid v1 locale preferences.
select
  count(*) filter (
    where locale not in ('system', 'zh-CN', 'zh-TW', 'en-US', 'fr-FR', 'es-ES', 'ja-JP', 'ko-KR', 'it-IT')
  ) as invalid_locale_count
from public.account_preferences;

-- Expected:
-- - invalid_locale_count = 0.

-- 4. RLS should remain enabled.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'account_preferences';

-- Expected:
-- - rowsecurity = true.

-- 5. Table privileges should remain account-scoped and unavailable to anon/public.
select
  grantee,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'account_preferences'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
group by grantee, table_name
order by grantee;

-- Expected:
-- - authenticated | account_preferences | INSERT, SELECT, UPDATE
-- - no anon or PUBLIC rows.

-- 6. account_preferences policies should still scope rows to auth.uid().
select
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'account_preferences'
order by policyname;

-- Expected:
-- - select own, insert own, update own.
-- - insert/update with_check should still reject default_space_id owned by another user.
