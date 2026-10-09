begin;

select plan(15);

select is(
  (
    select string_agg(proname || ':' || prosecdef::text, ', ' order by proname)
    from pg_proc
    where oid in (
      'public.admin_project_snapshot_summary(jsonb)'::regprocedure,
      'public.admin_read_profile(uuid)'::regprocedure,
      'public.admin_list_snapshots(uuid, uuid, timestamptz, uuid, integer)'::regprocedure,
      'public.admin_list_home_audit_events(uuid, uuid, timestamptz, uuid, integer)'::regprocedure
    )
      and proconfig @> array['search_path=""']
  ),
  'admin_list_home_audit_events:true, admin_list_snapshots:true, admin_project_snapshot_summary:false, admin_read_profile:true',
  'the readers should be security definer, the pure summary projection invoker, all with an empty search_path'
);

select ok(
  has_column_privilege('service_role', 'public.home_spaces', 'name', 'select')
    and has_column_privilege('service_role', 'public.home_spaces', 'access_mode', 'select')
    and not has_table_privilege('service_role', 'public.home_space_snapshots', 'select')
    and not has_table_privilege('anon', 'public.home_spaces', 'select'),
  'service_role should read only the home_spaces metadata columns directly'
);

select is(
  (
    select string_agg(distinct grantee, ', ' order by grantee)
    from information_schema.role_routine_grants
    where routine_schema = 'public'
      and routine_name in (
        'admin_project_snapshot_summary',
        'admin_read_profile',
        'admin_list_snapshots',
        'admin_list_home_audit_events'
      )
      and privilege_type = 'EXECUTE'
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  ),
  'service_role',
  'only service_role should be able to execute the admin read functions'
);

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
values (
  '00000000-0000-0000-0000-000000001232', repeat('h', 64), 'ciphertext', 'iv-iv-iv', 'salt-salt'
);

insert into public.home_spaces (id, user_id, sync_space_id, name, access_mode)
values (
  '00000000-0000-0000-0000-000000001233',
  '00000000-0000-0000-0000-000000001231',
  '00000000-0000-0000-0000-000000001232',
  'Bounded',
  'account-managed'
);

-- Two snapshots: an over-long one (newer) and a normal one (older).
insert into public.home_space_snapshots (
  id, user_id, home_space_id, sync_space_id, revision, snapshot_source, document_class,
  content_fingerprint, document_json, summary, created_at
)
values
  (
    '00000000-0000-0000-0000-000000001235',
    '00000000-0000-0000-0000-000000001231',
    '00000000-0000-0000-0000-000000001233',
    '00000000-0000-0000-0000-000000001232',
    2, 'after-cloud-push', 'user-data',
    repeat('f', 2000000),
    '{}'::jsonb,
    jsonb_build_object(
      'documentTitle', repeat('t', 100000),
      'groupCount', ('3.' || repeat('0', 16000))::numeric,
      'siteCount', 1e100,
      'widgetCount', 1.5,
      'themePresetId', repeat('x', 1000),
      'hasBanner', true,
      'hasBackground', 'yes',
      'padding', repeat('p', 1000000)
    ),
    '2026-03-02T00:00:00Z'
  ),
  (
    '00000000-0000-0000-0000-000000001234',
    '00000000-0000-0000-0000-000000001231',
    '00000000-0000-0000-0000-000000001233',
    '00000000-0000-0000-0000-000000001232',
    1, 'cloud-baseline', 'user-data',
    'fingerprint-one',
    '{}'::jsonb,
    '{"groupCount": 2, "siteCount": 5, "widgetCount": 0, "themePresetId": "classic", "hasBanner": false, "hasBackground": true}'::jsonb,
    '2026-03-01T00:00:00Z'
  );

insert into public.home_space_audit_events (
  id, user_id, home_space_id, event_type, severity, summary_before, summary_after, metadata,
  created_at
)
values (
  '00000000-0000-0000-0000-000000001236',
  '00000000-0000-0000-0000-000000001231',
  '00000000-0000-0000-0000-000000001233',
  repeat('e', 10000),
  'info',
  jsonb_build_object('padding', repeat('p', 1000000), 'groupCount', 4),
  null,
  jsonb_build_object(
    'snapshotSource', 'cloud-baseline',
    'source', repeat('s', 1000),
    'snapshotSaved', true,
    'url', 'https://private.example'
  ),
  '2026-03-03T00:00:00Z'
);

set local role service_role;

select is(
  (select display_name from public.admin_read_profile('00000000-0000-0000-0000-000000001231')),
  repeat('n', 80),
  'profile display names should be cut to 80 characters'
);

select is(
  (
    select array_agg(id::text order by created_at desc)
    from public.admin_list_snapshots(
      '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233',
      null, null, 51
    )
  ),
  array['00000000-0000-0000-0000-000000001235', '00000000-0000-0000-0000-000000001234'],
  'snapshots should list newest first'
);

select is(
  (
    select fingerprint_digest
    from public.admin_list_snapshots(
      '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233',
      null, null, 51
    )
    where id = '00000000-0000-0000-0000-000000001234'
  ),
  left(encode(sha256(convert_to('fingerprint-one', 'UTF8')), 'hex'), 12),
  'the fingerprint should leave the database only as a 12 character SHA-256 prefix'
);

select is(
  (
    select summary
    from public.admin_list_snapshots(
      '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233',
      null, null, 51
    )
    where id = '00000000-0000-0000-0000-000000001235'
  ),
  '{"groupCount": 3, "siteCount": null, "widgetCount": null, "themePresetId": null, "hasBanner": true, "hasBackground": null}'::jsonb,
  'snapshot summaries should keep only the six fields, rebuild counts as integers and drop over-long, fractional or out-of-range values'
);

select is(
  (
    select summary
    from public.admin_list_snapshots(
      '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233',
      null, null, 51
    )
    where id = '00000000-0000-0000-0000-000000001234'
  ),
  '{"groupCount": 2, "siteCount": 5, "widgetCount": 0, "themePresetId": "classic", "hasBanner": false, "hasBackground": true}'::jsonb,
  'a well-formed summary should pass through unchanged'
);

select ok(
  (
    select max(octet_length(s::text))
    from public.admin_list_snapshots(
      '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233',
      null, null, 51
    ) as s
  ) < 1000,
  'every snapshot row should stay small however large the stored columns are'
);

select is(
  (
    select array_agg(id::text)
    from public.admin_list_snapshots(
      '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233',
      '2026-03-02T00:00:00Z', '00000000-0000-0000-0000-000000001235', 51
    )
  ),
  array['00000000-0000-0000-0000-000000001234'],
  'the keyset cursor should continue after the given row'
);

select is(
  (
    select count(*)::integer
    from public.admin_list_snapshots(
      '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233',
      null, null, 1
    )
  ),
  1,
  'the limit should be honored'
);

select is(
  (
    select count(*)::integer
    from public.admin_list_snapshots(
      '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233',
      '2026-03-02T00:00:00Z', null, 51
    )
  ),
  0,
  'a cursor without an id should return nothing rather than ignore the cursor'
);

select is(
  (
    select event_type
    from public.admin_list_home_audit_events(
      '00000000-0000-0000-0000-000000001231', null, null, null, 51
    )
  ),
  'other',
  'an over-long event type should become other'
);

select is(
  (
    select metadata
    from public.admin_list_home_audit_events(
      '00000000-0000-0000-0000-000000001231', '00000000-0000-0000-0000-000000001233',
      null, null, 51
    )
  ),
  '{"snapshotSource": "cloud-baseline", "snapshotSaved": true}'::jsonb,
  'audit metadata should keep only short snapshotSource, source and snapshotSaved values'
);

select ok(
  (
    select octet_length(e::text) < 1000 and e.summary_before ->> 'groupCount' = '4'
      and e.summary_after is null
    from public.admin_list_home_audit_events(
      '00000000-0000-0000-0000-000000001231', null, null, null, 51
    ) as e
  ),
  'audit rows should stay small and keep projected summaries'
);

select * from finish();

rollback;
