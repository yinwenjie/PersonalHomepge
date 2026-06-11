-- Verify Phase 1.6.1 account-managed credential regex hotfix.
-- Run after supabase/migrations/007_account_managed_credential_regex_fix.sql.
--
-- This verification script is read-only.
-- Do not paste a full sync code into SQL Editor.

-- 1. Credential constraints should validate length and character set separately.
select
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as constraint_definition,
  case
    when pg_get_constraintdef(con.oid) like '%{32,512}%'
      then 'needs_fix'
    when pg_get_constraintdef(con.oid) like '%char_length%'
      and pg_get_constraintdef(con.oid) like '%[A-Za-z0-9_-]+%'
      then 'ok'
    else 'review'
  end as status
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'home_space_credentials'
  and con.conname in (
    'home_space_credentials_access_token_size',
    'home_space_credentials_encryption_key_size'
  )
order by con.conname;

-- Expected:
-- - two rows.
-- - both status values are ok.
-- - constraint_definition does not contain {32,512}.

-- 2. create_account_managed_home_space should no longer contain the invalid repetition range.
select
  p.proname as routine_name,
  case
    when pg_get_functiondef(p.oid) like '%{32,512}%'
      then 'needs_fix'
    when pg_get_functiondef(p.oid) like '%char_length(p_access_token)%'
      and pg_get_functiondef(p.oid) like '%char_length(p_encryption_key)%'
      and pg_get_functiondef(p.oid) like '%[A-Za-z0-9_-]+%'
      then 'ok'
    else 'review'
  end as status
from pg_proc p
join pg_namespace nsp on nsp.oid = p.pronamespace
where nsp.nspname = 'public'
  and p.proname = 'create_account_managed_home_space';

-- Expected:
-- - one row.
-- - status = ok.

-- 3. PostgreSQL should accept the replacement regex shape.
select
  'Aabcdefghijklmnopqrstuvwxyz0123456789_-XYZ' ~ '^[A-Za-z0-9_-]+$' as base64url_regex_ok,
  char_length('Aabcdefghijklmnopqrstuvwxyz0123456789_-XYZ') between 32 and 512 as length_check_ok;

-- Expected:
-- - base64url_regex_ok = true.
-- - length_check_ok = true.
