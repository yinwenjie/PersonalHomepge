begin;

select plan(12);

select ok(
  (
    select bool_and(prosecdef and proconfig @> array['search_path=""'])
    from pg_proc
    where oid in (
      'public.admin_list_users(timestamptz, uuid, integer)'::regprocedure,
      'public.admin_read_stats()'::regprocedure
    )
  ),
  'the user directory readers should be security definer with an empty search_path'
);

select is(
  (
    select string_agg(distinct routine_name || ':' || grantee, ', ' order by routine_name || ':' || grantee)
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in ('admin_mask_email', 'admin_list_users', 'admin_read_stats')
      and privilege_type = 'EXECUTE'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ),
  'admin_list_users:service_role, admin_mask_email:service_role, admin_read_stats:service_role',
  'only service_role should be able to list users, mask emails or read statistics'
);

select is(
  public.admin_mask_email('  Alice.Smith@Example.COM '),
  'a***@example.com',
  'a masked email should keep only the first character and the domain'
);

select is(
  array[public.admin_mask_email(null), public.admin_mask_email('no-at-sign'), public.admin_mask_email('@example.com')],
  array[null, null, null]::text[],
  'emails without a usable shape should mask to null'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at, is_anonymous, deleted_at
)
values
  ('00000000-0000-0000-0000-000000002501', 'authenticated', 'authenticated',
   'directory-a@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb,
   '2999-01-03T00:00:00Z', now(), now(), false, null),
  ('00000000-0000-0000-0000-000000002502', 'authenticated', 'authenticated',
   'directory-b@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb,
   '2999-01-02T00:00:00Z', now(), null, false, null),
  ('00000000-0000-0000-0000-000000002503', 'authenticated', 'authenticated',
   null, '', null, '{}'::jsonb, '{}'::jsonb,
   '2999-01-04T00:00:00Z', now(), null, true, null),
  ('00000000-0000-0000-0000-000000002504', 'authenticated', 'authenticated',
   'directory-deleted@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb,
   '2999-01-05T00:00:00Z', now(), null, false, now());

insert into public.sync_spaces (id, access_token_hash, document_ciphertext, document_iv, document_salt)
values
  ('00000000-0000-0000-0000-000000002511', repeat('h', 64), 'ciphertext', 'iv-iv-iv', 'salt-salt'),
  ('00000000-0000-0000-0000-000000002512', repeat('i', 64), 'ciphertext', 'iv-iv-iv', 'salt-salt');

insert into public.home_spaces (id, user_id, sync_space_id, name, access_mode)
values
  ('00000000-0000-0000-0000-000000002521', '00000000-0000-0000-0000-000000002501',
   '00000000-0000-0000-0000-000000002511', 'Managed', 'account-managed'),
  ('00000000-0000-0000-0000-000000002522', '00000000-0000-0000-0000-000000002501',
   '00000000-0000-0000-0000-000000002512', 'Sync code', 'sync-code');

insert into public.home_space_snapshots (
  id, user_id, home_space_id, sync_space_id, revision, snapshot_source, document_class,
  content_fingerprint, document_json, summary, created_at
)
values
  ('00000000-0000-0000-0000-000000002531', '00000000-0000-0000-0000-000000002501',
   '00000000-0000-0000-0000-000000002521', '00000000-0000-0000-0000-000000002511',
   1, 'cloud-baseline', 'user-data', 'fp', '{"version": 2}'::jsonb, '{}'::jsonb,
   '2026-01-01T00:00:00Z'),
  ('00000000-0000-0000-0000-000000002532', '00000000-0000-0000-0000-000000002501',
   '00000000-0000-0000-0000-000000002521', '00000000-0000-0000-0000-000000002511',
   2, 'after-cloud-push', 'user-data', 'fp2', '{"version": 2}'::jsonb, '{}'::jsonb,
   '2026-01-02T00:00:00Z');

set local role service_role;

select is(
  (select array_agg(id::text order by created_at desc) from public.admin_list_users(null, null, 2)),
  array['00000000-0000-0000-0000-000000002501', '00000000-0000-0000-0000-000000002502'],
  'users should be listed newest first, skipping newer anonymous and soft-deleted users'
);

select is(
  (
    select row(masked_email, home_space_count, account_managed_space_count, sync_code_space_count,
      snapshot_count, last_snapshot_at)::text
    from public.admin_list_users(null, null, 50)
    where id = '00000000-0000-0000-0000-000000002501'
  ),
  row('d***@example.invalid', 2, 1, 1, 2, '2026-01-02T00:00:00Z'::timestamptz)::text,
  'a listed user should carry the masked email and space and snapshot counts'
);

select is(
  (
    select count(*)::integer
    from public.admin_list_users(null, null, 50)
    where id in ('00000000-0000-0000-0000-000000002503', '00000000-0000-0000-0000-000000002504')
  ),
  0,
  'anonymous and soft-deleted users should not be listed'
);

select is(
  (
    select array_agg(id::text)
    from public.admin_list_users('2999-01-03T00:00:00Z', '00000000-0000-0000-0000-000000002501', 1)
  ),
  array['00000000-0000-0000-0000-000000002502'],
  'the keyset cursor should continue after the given user'
);

select ok(
  (select count(*) <= 51 from public.admin_list_users(null, null, 500)),
  'a page should hold at most 51 rows'
);

select ok(
  (
    select not exists (
      select 1 from public.admin_list_users(null, null, 50) as u
      where u.masked_email like 'directory-%'
    )
  ),
  'no listed email should leave the database unmasked'
);

select is(
  (
    select array[
      jsonb_typeof(s -> 'users' -> 'total'),
      jsonb_typeof(s -> 'homeSpaces' -> 'syncCode'),
      jsonb_typeof(s -> 'visitors' -> 'last30d'),
      (jsonb_array_length(s -> 'daily'))::text
    ]
    from (select public.admin_read_stats() as s) as stats
  ),
  array['number', 'number', 'number', '30'],
  'statistics should be numbers with a 30-day daily series'
);

reset role;
set local role authenticated;

select throws_ok(
  'select public.admin_read_stats()',
  '42501',
  null,
  'authenticated users should not read statistics'
);

select * from finish();

rollback;
