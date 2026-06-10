-- Verify Phase 1.5.4 account home-space claim state.
-- Run this file in Supabase Dashboard SQL Editor.
--
-- Replace:
-- - your-email@example.com with the signed-in account email.
-- - paste-sync-space-uuid-here with the UUID part of a sync code when checking a specific space.
--
-- Do not paste a full sync code into SQL Editor. The full code contains accessToken and encryptionKey.
-- The sync code format is hp1_<sync_space_id>_<accessToken>_<encryptionKey>.

-- 1. Check that Auth, profile, and account preferences exist for the target user.
select
  u.id as user_id,
  u.email,
  u.created_at as auth_created_at,
  u.last_sign_in_at,
  p.id as profile_id,
  p.display_name,
  ap.locale,
  ap.theme_preference,
  ap.default_space_id
from auth.users u
left join public.profiles p on p.id = u.id
left join public.account_preferences ap on ap.user_id = u.id
where lower(u.email) = lower('your-email@example.com');

-- Expected:
-- - one auth.users row for the email.
-- - profile_id is not null after Phase 1.5.3 initialization.
-- - locale/theme_preference are present after Phase 1.5.3 initialization.

-- 2. List all home spaces claimed by the target account.
with target_user as (
  select id, email
  from auth.users
  where lower(email) = lower('your-email@example.com')
)
select
  u.email,
  hs.id as home_space_id,
  hs.name,
  hs.sync_space_id,
  hs.is_default,
  hs.last_used_at,
  hs.created_at as claimed_at,
  ss.revision,
  ss.updated_at as sync_updated_at,
  ss.last_pulled_at,
  ss.revoked_at,
  case
    when ss.id is null then 'missing_sync_space'
    when ss.revoked_at is not null then 'revoked'
    else 'active'
  end as sync_status
from target_user u
join public.home_spaces hs on hs.user_id = u.id
left join public.sync_spaces ss on ss.id = hs.sync_space_id
order by hs.is_default desc, hs.created_at asc;

-- Expected:
-- - one row for each claimed home space.
-- - sync_status is active for usable sync spaces.
-- - no accessToken, encryptionKey, or full sync code appears in the result.

-- 3. Check whether a specific sync_space_id has been claimed by the target account.
with target_user as (
  select id, email
  from auth.users
  where lower(email) = lower('your-email@example.com')
)
select
  u.email,
  hs.id as home_space_id,
  hs.name,
  hs.sync_space_id,
  hs.created_at as claimed_at,
  ss.revision,
  ss.revoked_at
from target_user u
join public.home_spaces hs on hs.user_id = u.id
join public.sync_spaces ss on ss.id = hs.sync_space_id
where hs.sync_space_id = 'paste-sync-space-uuid-here'::uuid;

-- Expected:
-- - one row means this account has claimed that sync space.
-- - zero rows means the account has not claimed it, the email is wrong, or the sync_space_id is wrong.
-- - revoked_at not null means the sync code has been revoked and should not be used for sync.
