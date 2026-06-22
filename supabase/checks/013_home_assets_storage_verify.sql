-- Verify Phase 1.8.1 homepage image Storage setup.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/012_home_assets_storage.sql

-- 1. The private home-assets bucket should exist with strict image limits.
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'home-assets';

-- Expected:
-- - id/name = home-assets
-- - public = false
-- - file_size_limit = 5242880
-- - allowed_mime_types contains image/jpeg, image/png, image/webp, image/gif.

-- 2. Storage object policies should exist for authenticated users only.
select
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in (
    'home assets insert own folder',
    'home assets read own folder',
    'home assets update own folder',
    'home assets delete own folder'
  )
order by policyname;

-- Expected:
-- - four rows.
-- - roles include authenticated.
-- - policies constrain bucket_id to home-assets.
-- - policies constrain first folder segment to auth.uid().
-- - policies constrain second folder segment to banner/background.

-- 3. Storage objects RLS should be enabled by Supabase.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'storage'
  and tablename = 'objects';

-- Expected: rowsecurity = true.
