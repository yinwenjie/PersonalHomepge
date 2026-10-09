begin;

select plan(7);

select ok(
  (
    select prosecdef and proconfig @> array['search_path=""']
    from pg_proc
    where oid = 'public.admin_read_snapshot_document(uuid, uuid, uuid, integer)'::regprocedure
  ),
  'the snapshot document reader should be security definer with an empty search_path'
);

select is(
  (
    select string_agg(grantee, ', ' order by grantee)
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name = 'admin_read_snapshot_document'
      and privilege_type = 'EXECUTE'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ),
  'service_role',
  'only service_role should be able to read snapshot documents'
);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000001241', 'authenticated', 'authenticated',
   'phase-1-18-preview-a@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000001242', 'authenticated', 'authenticated',
   'phase-1-18-preview-b@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.sync_spaces (id, access_token_hash, document_ciphertext, document_iv, document_salt)
values
  ('00000000-0000-0000-0000-000000001243', repeat('h', 64), 'ciphertext', 'iv-iv-iv', 'salt-salt'),
  ('00000000-0000-0000-0000-000000001244', repeat('i', 64), 'ciphertext', 'iv-iv-iv', 'salt-salt');

insert into public.home_spaces (id, user_id, sync_space_id, name, access_mode)
values
  ('00000000-0000-0000-0000-000000001245', '00000000-0000-0000-0000-000000001241',
   '00000000-0000-0000-0000-000000001243', 'Managed', 'account-managed'),
  ('00000000-0000-0000-0000-000000001246', '00000000-0000-0000-0000-000000001241',
   '00000000-0000-0000-0000-000000001244', 'Sync code', 'account-managed');

insert into public.home_space_snapshots (
  id, user_id, home_space_id, sync_space_id, revision, snapshot_source, document_class,
  content_fingerprint, document_json, summary
)
values
  ('00000000-0000-0000-0000-000000001247', '00000000-0000-0000-0000-000000001241',
   '00000000-0000-0000-0000-000000001245', '00000000-0000-0000-0000-000000001243',
   3, 'after-cloud-push', 'user-data', 'fp', '{"version": 2, "groups": []}'::jsonb, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000001248', '00000000-0000-0000-0000-000000001241',
   '00000000-0000-0000-0000-000000001245', '00000000-0000-0000-0000-000000001243',
   4, 'after-cloud-push', 'user-data', 'fp2',
   jsonb_build_object('version', 2, 'groups', '[]'::jsonb, 'padding', repeat('p', 3000000)),
   '{}'::jsonb),
  ('00000000-0000-0000-0000-000000001249', '00000000-0000-0000-0000-000000001241',
   '00000000-0000-0000-0000-000000001246', '00000000-0000-0000-0000-000000001244',
   1, 'cloud-baseline', 'user-data', 'fp3', '{"version": 2, "groups": []}'::jsonb, '{}'::jsonb);

-- The second space stops being account-managed after its snapshot was taken.
update public.home_spaces
set access_mode = 'sync-code'
where id = '00000000-0000-0000-0000-000000001246';

set local role service_role;

select is(
  (
    select document_json
    from public.admin_read_snapshot_document(
      '00000000-0000-0000-0000-000000001241', '00000000-0000-0000-0000-000000001245',
      '00000000-0000-0000-0000-000000001247', 1048576
    )
  ),
  '{"version": 2, "groups": []}'::jsonb,
  'a matching account-managed snapshot should return its document'
);

select ok(
  (
    select document_json is null and document_bytes > 3000000 and revision = 4
    from public.admin_read_snapshot_document(
      '00000000-0000-0000-0000-000000001241', '00000000-0000-0000-0000-000000001245',
      '00000000-0000-0000-0000-000000001248', 1048576
    )
  ),
  'a document over the size limit should return only its size'
);

select is(
  (
    select count(*)::integer
    from public.admin_read_snapshot_document(
      '00000000-0000-0000-0000-000000001242', '00000000-0000-0000-0000-000000001245',
      '00000000-0000-0000-0000-000000001247', 1048576
    )
  ),
  0,
  'another user id should not reach the snapshot'
);

select is(
  (
    select count(*)::integer
    from public.admin_read_snapshot_document(
      '00000000-0000-0000-0000-000000001241', '00000000-0000-0000-0000-000000001246',
      '00000000-0000-0000-0000-000000001247', 1048576
    )
  ),
  0,
  'another space id should not reach the snapshot'
);

select is(
  (
    select count(*)::integer
    from public.admin_read_snapshot_document(
      '00000000-0000-0000-0000-000000001241', '00000000-0000-0000-0000-000000001246',
      '00000000-0000-0000-0000-000000001249', 1048576
    )
  ),
  0,
  'snapshots of a space that is no longer account-managed should not be readable'
);

select * from finish();

rollback;
