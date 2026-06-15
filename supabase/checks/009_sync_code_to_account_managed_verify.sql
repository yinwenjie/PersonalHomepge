-- Verify Phase 1.6.3 sync-code to account-managed migration.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/008_sync_code_to_account_managed.sql
--
-- The default sections are read-only.
-- Do not paste production sync codes unless you are running the optional rollback block.

-- 1. Migration RPC should exist with the expected signature.
select
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'migrate_sync_code_home_space_to_account_managed';

-- Expected:
-- - one row.
-- - arguments include p_home_space_id uuid, p_access_token text, p_encryption_key text.
-- - result includes status, home_space_id, sync_space_id, access_mode, updated_at.

-- 2. Migration RPC should only be executable by authenticated.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name = 'migrate_sync_code_home_space_to_account_managed'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by grantee, privilege_type;

-- Expected:
-- - authenticated | EXECUTE
-- - no anon or PUBLIC EXECUTE row.

-- 3. RPC source should not revoke or modify sync_spaces documents.
select
  case
    when p.prosrc ilike '%update public.sync_spaces%'
      or p.prosrc ilike '%document_ciphertext%'
      or p.prosrc ilike '%document_iv%'
      or p.prosrc ilike '%document_salt%'
    then 'review_required'
    else 'ok'
  end as sync_space_mutation_check
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'migrate_sync_code_home_space_to_account_managed';

-- Expected: ok.
-- The function should validate sync_spaces access but not change sync_spaces.

-- 4. Credential table should still be protected by RLS and narrow grants.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('home_spaces', 'home_space_credentials', 'sync_spaces')
order by tablename;

select
  grantee,
  table_name,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('home_space_credentials', 'sync_spaces')
  and grantee in ('anon', 'authenticated')
group by grantee, table_name
order by table_name, grantee;

-- Expected:
-- - listed tables have rowsecurity = true.
-- - authenticated has INSERT, SELECT, UPDATE on home_space_credentials.
-- - no anon row for home_space_credentials.
-- - no rows for sync_spaces.

-- 5. No migrated account-managed space should be missing an active credential.
select
  hs.id,
  hs.user_id,
  hs.sync_space_id,
  hs.name
from public.home_spaces hs
where hs.access_mode = 'account-managed'
  and not exists (
    select 1
    from public.home_space_credentials c
    where c.home_space_id = hs.id
      and c.user_id = hs.user_id
      and c.credential_type = 'sync-space-v1'
      and c.revoked_at is null
  );

-- Expected: 0 rows.

-- 6. Credential ownership metadata should remain internally consistent.
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

-- 7. There should be at most one active sync-space-v1 credential per home space.
select
  home_space_id,
  count(*) as active_credential_count
from public.home_space_credentials
where revoked_at is null
  and credential_type = 'sync-space-v1'
group by home_space_id
having count(*) > 1;

-- Expected: 0 rows.

-- 8. Optional functional rollback test.
-- Replace these placeholders before running this section:
-- - 00000000-0000-0000-0000-00000000000a -> user A auth.users.id
-- - 00000000-0000-0000-0000-00000000000b -> user B auth.users.id
-- - 00000000-0000-0000-0000-0000000000a1 -> a sync-code home_spaces.id owned by user A
-- - 00000000-0000-0000-0000-0000000000b1 -> a home_spaces.id owned by user B
-- - hp_access_token_for_a -> access token for user A's home space sync code
-- - hp_encryption_key_for_a -> encryption key for user A's home space sync code
--
-- This block should not permanently modify data because it rolls back.
/*
begin;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
set local role authenticated;

select *
from public.migrate_sync_code_home_space_to_account_managed(
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  'hp_access_token_for_a',
  'hp_encryption_key_for_a'
);

select
  'user_a_credential_visible_after_migration' as check_name,
  count(*) as visible_rows
from public.home_space_credentials
where home_space_id = '00000000-0000-0000-0000-0000000000a1'::uuid
  and revoked_at is null;

rollback;
*/

-- Expected for section 8:
-- - migration returns one row with status = migrated or already-managed.
-- - visible_rows = 1.
--
-- Optional negative checks to run separately after replacing placeholders:
-- - As user A, this should fail with "Home space not found for current account":
--   select public.migrate_sync_code_home_space_to_account_managed(
--     '00000000-0000-0000-0000-0000000000b1'::uuid,
--     'hp_access_token_for_a',
--     'hp_encryption_key_for_a'
--   );
-- - As user A, this should fail with "Sync space not found or token invalid" if token is wrong:
--   select public.migrate_sync_code_home_space_to_account_managed(
--     '00000000-0000-0000-0000-0000000000a1'::uuid,
--     'wrong_access_token_with_valid_length_000000000000',
--     'hp_encryption_key_for_a'
--   );
