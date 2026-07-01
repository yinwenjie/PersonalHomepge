-- Verify Phase 1.6.6 editable account preferences.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/010_account_preferences_editing.sql
-- - supabase/migrations/011_account_preferences_search_engine_yandex.sql

-- 1. New account preference columns should exist with expected defaults.
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'account_preferences'
  and column_name in (
    'locale',
    'theme_preference',
    'font_family',
    'density',
    'default_search_engine',
    'default_space_id'
  )
order by column_name;

-- Expected:
-- - font_family text not null default 'system'
-- - density text not null default 'comfortable'
-- - default_search_engine text not null default 'duckduckgo'
-- - existing locale/theme_preference/default_space_id remain present.

-- 2. Preference enum-like check constraints should exist.
select
  conname as constraint_name,
  pg_get_constraintdef(oid) as constraint_definition
from pg_constraint
where conrelid = 'public.account_preferences'::regclass
  and conname in (
    'account_preferences_locale_allowed',
    'account_preferences_theme_preference_allowed',
    'account_preferences_font_family_allowed',
    'account_preferences_density_allowed',
    'account_preferences_default_search_engine_allowed'
  )
order by conname;

-- Expected: five rows, each limiting values to the current allowed set.

-- 3. RLS should remain enabled.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'account_preferences';

-- Expected: rowsecurity = true.

-- 4. Table privileges should remain account-scoped and unavailable to anon/public.
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

-- 5. default_space_id FK should still set null on home space removal.
select
  conrelid::regclass as child_table,
  conname as constraint_name,
  confrelid::regclass as parent_table,
  confdeltype as delete_action
from pg_constraint
where conrelid = 'public.account_preferences'::regclass
  and confrelid = 'public.home_spaces'::regclass
order by conname;

-- Expected:
-- - account_preferences_default_space_fk delete_action = n (set null).

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

-- 7. Existing rows should still not point default_space_id at another user's home_space.
select
  ap.user_id,
  ap.default_space_id,
  hs.user_id as home_space_user_id
from public.account_preferences ap
join public.home_spaces hs on hs.id = ap.default_space_id
where ap.default_space_id is not null
  and hs.user_id <> ap.user_id;

-- Expected: 0 rows.

-- 8. Existing rows should now have valid non-null editable preference values.
select
  count(*) filter (where locale not in ('system', 'zh-CN', 'zh-TW', 'en-US', 'fr-FR', 'es-ES', 'ja-JP', 'ko-KR', 'it-IT')) as invalid_locale_count,
  count(*) filter (where theme_preference not in ('system', 'light', 'dark')) as invalid_theme_count,
  count(*) filter (where font_family not in ('system', 'serif', 'mono')) as invalid_font_count,
  count(*) filter (where density not in ('comfortable', 'compact')) as invalid_density_count,
  count(*) filter (where default_search_engine not in ('duckduckgo', 'google', 'bing', 'yandex')) as invalid_search_engine_count
from public.account_preferences;

-- Expected: all counts = 0.
