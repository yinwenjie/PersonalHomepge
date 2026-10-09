-- Verify the admin-read snapshot document reader.
-- Run after supabase/migrations/024_admin_snapshot_preview.sql.
--
-- Writes only synthetic fixtures inside a transaction that always rolls back.
-- Any unexpected result raises, so the deploy runner fails. Do not use production data.

begin;

do $$
begin
  if to_regprocedure('public.admin_read_snapshot_document(uuid, uuid, uuid, integer)') is null then
    raise exception 'admin_read_snapshot_document is missing; is migration 024 applied?';
  end if;

  if not (select prosecdef from pg_proc
    where oid = 'public.admin_read_snapshot_document(uuid, uuid, uuid, integer)'::regprocedure) then
    raise exception 'admin_read_snapshot_document must be security definer';
  end if;

  if has_function_privilege('anon', 'public.admin_read_snapshot_document(uuid, uuid, uuid, integer)', 'execute')
    or has_function_privilege('authenticated', 'public.admin_read_snapshot_document(uuid, uuid, uuid, integer)', 'execute') then
    raise exception 'anon or authenticated can read snapshot documents';
  end if;

  if not has_function_privilege('service_role', 'public.admin_read_snapshot_document(uuid, uuid, uuid, integer)', 'execute') then
    raise exception 'service_role cannot read snapshot documents';
  end if;
end;
$$;

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

update public.home_spaces
set access_mode = 'sync-code'
where id = '00000000-0000-0000-0000-000000001246';

set local role service_role;

do $$
declare
  v_document jsonb;
  v_count integer;
begin
  select document_json into v_document
  from public.admin_read_snapshot_document(
    '00000000-0000-0000-0000-000000001241', '00000000-0000-0000-0000-000000001245',
    '00000000-0000-0000-0000-000000001247', 1048576
  );
  if v_document is distinct from '{"version": 2, "groups": []}'::jsonb then
    raise exception 'a matching snapshot did not return its document';
  end if;

  select count(*) into v_count
  from public.admin_read_snapshot_document(
    '00000000-0000-0000-0000-000000001241', '00000000-0000-0000-0000-000000001245',
    '00000000-0000-0000-0000-000000001248', 1048576
  )
  where document_json is null and document_bytes > 3000000;
  if v_count <> 1 then
    raise exception 'an oversized document was returned or its size is missing';
  end if;

  select count(*) into v_count
  from (
    select 1 from public.admin_read_snapshot_document(
      '00000000-0000-0000-0000-000000001242', '00000000-0000-0000-0000-000000001245',
      '00000000-0000-0000-0000-000000001247', 1048576)
    union all
    select 1 from public.admin_read_snapshot_document(
      '00000000-0000-0000-0000-000000001241', '00000000-0000-0000-0000-000000001246',
      '00000000-0000-0000-0000-000000001247', 1048576)
    union all
    select 1 from public.admin_read_snapshot_document(
      '00000000-0000-0000-0000-000000001241', '00000000-0000-0000-0000-000000001246',
      '00000000-0000-0000-0000-000000001249', 1048576)
  ) as leaked;
  if v_count <> 0 then
    raise exception 'a snapshot was readable through a wrong user, wrong space or sync-code space';
  end if;
end;
$$;

reset role;

select 'admin snapshot preview reader verified' as result;

rollback;
