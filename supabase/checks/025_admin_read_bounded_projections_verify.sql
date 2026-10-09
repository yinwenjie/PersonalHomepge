-- Verify the bounded admin-read functions.
-- Run after supabase/migrations/023_admin_read_bounded_projections.sql.
--
-- Writes only synthetic fixtures inside a transaction that always rolls back.
-- Any unexpected result raises, so the deploy runner fails. Do not use production data.

begin;

do $$
begin
  if to_regprocedure('public.admin_list_snapshots(uuid, uuid, timestamptz, uuid, integer)') is null
    or to_regprocedure('public.admin_list_home_audit_events(uuid, uuid, timestamptz, uuid, integer)') is null
    or to_regprocedure('public.admin_read_profile(uuid)') is null
    or to_regprocedure('public.admin_project_snapshot_summary(jsonb)') is null then
    raise exception 'admin read functions are missing; is migration 023 applied?';
  end if;

  if not (select prosecdef from pg_proc where oid = 'public.admin_list_snapshots(uuid, uuid, timestamptz, uuid, integer)'::regprocedure)
    or not (select prosecdef from pg_proc where oid = 'public.admin_list_home_audit_events(uuid, uuid, timestamptz, uuid, integer)'::regprocedure)
    or not (select prosecdef from pg_proc where oid = 'public.admin_read_profile(uuid)'::regprocedure) then
    raise exception 'admin read functions must be security definer';
  end if;

  if has_function_privilege('anon', 'public.admin_list_snapshots(uuid, uuid, timestamptz, uuid, integer)', 'execute')
    or has_function_privilege('authenticated', 'public.admin_list_snapshots(uuid, uuid, timestamptz, uuid, integer)', 'execute')
    or has_function_privilege('anon', 'public.admin_list_home_audit_events(uuid, uuid, timestamptz, uuid, integer)', 'execute')
    or has_function_privilege('authenticated', 'public.admin_list_home_audit_events(uuid, uuid, timestamptz, uuid, integer)', 'execute')
    or has_function_privilege('anon', 'public.admin_read_profile(uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.admin_read_profile(uuid)', 'execute')
    or has_function_privilege('anon', 'public.admin_project_snapshot_summary(jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.admin_project_snapshot_summary(jsonb)', 'execute') then
    raise exception 'anon or authenticated can call an admin read function';
  end if;

  if not has_function_privilege('service_role', 'public.admin_list_snapshots(uuid, uuid, timestamptz, uuid, integer)', 'execute')
    or not has_function_privilege('service_role', 'public.admin_list_home_audit_events(uuid, uuid, timestamptz, uuid, integer)', 'execute')
    or not has_function_privilege('service_role', 'public.admin_read_profile(uuid)', 'execute') then
    raise exception 'service_role cannot call the admin read functions';
  end if;

  if not has_column_privilege('service_role', 'public.home_spaces', 'access_mode', 'select')
    or not has_column_privilege('service_role', 'public.home_spaces', 'last_used_at', 'select') then
    raise exception 'service_role cannot read the home_spaces metadata columns';
  end if;
end;
$$;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000001231', 'authenticated', 'authenticated',
  'phase-1-18-bounded@example.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.profiles (id, email, display_name)
values ('00000000-0000-0000-0000-000000001231', 'phase-1-18-bounded@example.invalid', repeat('n', 5000))
on conflict (id) do update set display_name = excluded.display_name;

insert into public.sync_spaces (id, access_token_hash, document_ciphertext, document_iv, document_salt)
values ('00000000-0000-0000-0000-000000001232', repeat('h', 64), 'ciphertext', 'iv-iv-iv', 'salt-salt');

insert into public.home_spaces (id, user_id, sync_space_id, name, access_mode)
values (
  '00000000-0000-0000-0000-000000001233', '00000000-0000-0000-0000-000000001231',
  '00000000-0000-0000-0000-000000001232', 'Bounded', 'account-managed'
);

insert into public.home_space_snapshots (
  id, user_id, home_space_id, sync_space_id, revision, snapshot_source, document_class,
  content_fingerprint, document_json, summary
)
values (
  '00000000-0000-0000-0000-000000001235', '00000000-0000-0000-0000-000000001231',
  '00000000-0000-0000-0000-000000001233', '00000000-0000-0000-0000-000000001232',
  1, 'after-cloud-push', 'user-data', repeat('f', 2000000), '{}'::jsonb,
  jsonb_build_object('documentTitle', repeat('t', 100000), 'groupCount', 3,
    'siteCount', ('5.' || repeat('0', 16000))::numeric,
    'themePresetId', repeat('x', 1000), 'padding', repeat('p', 1000000))
);

insert into public.home_space_audit_events (
  user_id, home_space_id, event_type, severity, summary_after, metadata
)
values (
  '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233',
  repeat('e', 10000), 'info', jsonb_build_object('padding', repeat('p', 1000000)),
  jsonb_build_object('snapshotSaved', true, 'url', 'https://private.example')
);

set local role service_role;

do $$
declare
  v_size integer;
  v_text text;
begin
  select char_length(display_name) into v_size
  from public.admin_read_profile('00000000-0000-0000-0000-000000001231');
  if v_size is distinct from 80 then
    raise exception 'display_name was not cut to 80 characters (got %)', v_size;
  end if;

  select max(octet_length(s::text)), max(s.summary::text) into v_size, v_text
  from public.admin_list_snapshots(
    '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233', null, null, 51
  ) as s;
  if v_size is null or v_size >= 1000 or v_text like '%documentTitle%'
    or v_text not like '%"siteCount": 5,%' then
    raise exception 'snapshot rows are not bounded (size %)', v_size;
  end if;

  select max(octet_length(e::text)), max(e.event_type) into v_size, v_text
  from public.admin_list_home_audit_events(
    '00000000-0000-0000-0000-000000001231', null, null, null, 51
  ) as e;
  if v_size is null or v_size >= 1000 or v_text <> 'other' then
    raise exception 'audit rows are not bounded (size %, event type %)', v_size, left(v_text, 20);
  end if;
end;
$$;

reset role;

select 'admin read projections verified' as result;

rollback;
