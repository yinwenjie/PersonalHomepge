-- Verify Phase 1.11.9 privacy-first client error monitoring.
-- Run this file in Supabase Dashboard SQL Editor after:
-- - supabase/migrations/015_client_error_events.sql
--
-- This verification script is read-only.

-- 1. Client error table should exist with RLS enabled.
select
  schemaname,
  tablename,
  rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'client_error_events';

-- Expected:
-- - one row.
-- - rowsecurity = true.

-- 2. Frontend roles should not have direct table access.
select
  grantee,
  table_name,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'client_error_events'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by grantee, privilege_type;

-- Expected:
-- - 0 rows.

-- 3. No direct RLS policy should expose error rows to normal clients.
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'client_error_events'
order by policyname;

-- Expected:
-- - 0 rows in v1. Clients write only through record_client_error_event(...).

-- 4. Controlled RPC should be executable by anon and authenticated only.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name = 'record_client_error_event'
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by grantee, privilege_type;

-- Expected:
-- - anon EXECUTE exists.
-- - authenticated EXECUTE exists.
-- - PUBLIC has no EXECUTE row.

-- 5. Helper functions should not be executable by frontend roles.
select
  routine_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where specific_schema = 'public'
  and routine_name in (
    'client_error_event_type_allowed',
    'client_error_json_has_forbidden_key',
    'client_error_properties_allowed',
    'delete_client_error_events_older_than'
  )
  and grantee in ('anon', 'authenticated', 'PUBLIC')
order by routine_name, grantee, privilege_type;

-- Expected:
-- - 0 rows.

-- 6. Error table should not contain obvious sensitive columns.
select
  column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'client_error_events'
  and column_name in (
    'access_token',
    'accessToken',
    'document_json',
    'documentJson',
    'email',
    'encryption_key',
    'encryptionKey',
    'home_document',
    'homeDocument',
    'search_term',
    'searchTerm',
    'sync_code',
    'syncCode',
    'url',
    'user_id',
    'userId'
  )
order by column_name;

-- Expected:
-- - 0 rows.

-- 7. Privacy and validation constraints should exist.
select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.client_error_events'::regclass
  and conname in (
    'client_error_events_event_type_valid',
    'client_error_events_severity_valid',
    'client_error_events_properties_allowed',
    'client_error_events_properties_no_forbidden_keys',
    'client_error_events_properties_size',
    'client_error_events_schema_version_valid'
  )
order by conname;

-- Expected:
-- - six rows.
-- - definitions mention event/severity whitelist, allowed properties, forbidden key protection, max size and schema version.

-- 8. RPC source should validate event type, fingerprint, anonymous id, message and properties.
select
  proname,
  prosrc ilike '%client_error_event_type_allowed%' as checks_event_type,
  prosrc ilike '%p_fingerprint%' as checks_fingerprint,
  prosrc ilike '%p_anonymous_id%' as checks_anonymous_id,
  prosrc ilike '%p_message_sanitized%' as checks_message,
  prosrc ilike '%client_error_properties_allowed%' as checks_property_allowlist,
  prosrc ilike '%client_error_json_has_forbidden_key%' as checks_forbidden_keys
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname = 'record_client_error_event';

-- Expected:
-- - all boolean columns are true.

-- 9. Optional negative insert checks. This block rolls back.
/*
begin;

select public.record_client_error_event(
  'async_operation_failed',
  'error',
  1,
  'err-testvalid123',
  'diag-testvalid123',
  'session-testvalid123',
  '/edit',
  'sync.pull',
  'Error',
  'verify failure',
  'Error: verify failure',
  null,
  '{"source":"verify","online":true}'::jsonb,
  now(),
  'verify'
) as ok_event_id;

-- Expected to fail: forbidden property key.
select public.record_client_error_event(
  'async_operation_failed',
  'error',
  1,
  'err-testvalid123',
  'diag-testvalid123',
  'session-testvalid123',
  '/edit',
  'sync.pull',
  'Error',
  'verify failure',
  null,
  null,
  '{"url":"https://example.com"}'::jsonb,
  now(),
  'verify'
);

rollback;
*/
