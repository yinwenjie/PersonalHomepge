begin;

-- Phase 1.11.5: cloud history for account-managed home spaces.
-- Ordinary sync-code spaces keep the existing encrypted-only sync boundary.

create table if not exists public.home_space_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  home_space_id uuid not null,
  sync_space_id uuid not null references public.sync_spaces(id) on delete restrict,
  revision integer not null,
  snapshot_source text not null,
  document_class text not null,
  content_fingerprint text not null,
  document_json jsonb,
  summary jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  client_device_id text,
  operation_id text,
  created_at timestamptz not null default now(),
  constraint home_space_snapshots_home_space_fk
    foreign key (home_space_id, user_id)
    references public.home_spaces(id, user_id)
    on delete cascade,
  constraint home_space_snapshots_revision_range check (revision between 0 and 999),
  constraint home_space_snapshots_source_valid check (snapshot_source in (
    'account-managed-created',
    'cloud-baseline',
    'after-cloud-push',
    'after-cloud-force-push'
  )),
  constraint home_space_snapshots_document_class_user_data check (document_class = 'user-data'),
  constraint home_space_snapshots_document_json_object check (
    document_json is not null
    and jsonb_typeof(document_json) = 'object'
  ),
  constraint home_space_snapshots_summary_object check (jsonb_typeof(summary) = 'object'),
  constraint home_space_snapshots_content_fingerprint_not_empty check (char_length(content_fingerprint) > 0),
  constraint home_space_snapshots_client_device_id_size check (client_device_id is null or char_length(client_device_id) <= 160),
  constraint home_space_snapshots_operation_id_size check (operation_id is null or char_length(operation_id) <= 160)
);

create index if not exists home_space_snapshots_home_space_created_idx
  on public.home_space_snapshots(home_space_id, created_at desc);
create index if not exists home_space_snapshots_user_created_idx
  on public.home_space_snapshots(user_id, created_at desc);
create index if not exists home_space_snapshots_sync_space_revision_idx
  on public.home_space_snapshots(sync_space_id, revision desc);

create table if not exists public.home_space_audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  home_space_id uuid,
  sync_space_id uuid references public.sync_spaces(id) on delete set null,
  event_type text not null,
  severity text not null default 'info',
  before_revision integer,
  after_revision integer,
  snapshot_id uuid references public.home_space_snapshots(id) on delete set null,
  document_class_before text,
  document_class_after text,
  summary_before jsonb,
  summary_after jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  client_device_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint home_space_audit_events_home_space_fk
    foreign key (home_space_id)
    references public.home_spaces(id)
    on delete set null,
  constraint home_space_audit_events_severity_valid check (severity in ('info', 'warning', 'danger')),
  constraint home_space_audit_events_before_revision_range check (before_revision is null or before_revision between 0 and 999),
  constraint home_space_audit_events_after_revision_range check (after_revision is null or after_revision between 0 and 999),
  constraint home_space_audit_events_class_before_valid check (
    document_class_before is null or document_class_before in ('system-default', 'system-blank', 'system-template', 'user-data')
  ),
  constraint home_space_audit_events_class_after_valid check (
    document_class_after is null or document_class_after in ('system-default', 'system-blank', 'system-template', 'user-data')
  ),
  constraint home_space_audit_events_summary_before_object check (summary_before is null or jsonb_typeof(summary_before) = 'object'),
  constraint home_space_audit_events_summary_after_object check (summary_after is null or jsonb_typeof(summary_after) = 'object'),
  constraint home_space_audit_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint home_space_audit_events_client_device_id_size check (client_device_id is null or char_length(client_device_id) <= 160)
);

create index if not exists home_space_audit_events_user_created_idx
  on public.home_space_audit_events(user_id, created_at desc);
create index if not exists home_space_audit_events_home_space_created_idx
  on public.home_space_audit_events(home_space_id, created_at desc);
create index if not exists home_space_audit_events_sync_space_created_idx
  on public.home_space_audit_events(sync_space_id, created_at desc);
create index if not exists home_space_audit_events_snapshot_id_idx
  on public.home_space_audit_events(snapshot_id);

alter table public.home_space_snapshots enable row level security;
alter table public.home_space_audit_events enable row level security;

revoke all on table public.home_space_snapshots from anon;
revoke all on table public.home_space_snapshots from public;
revoke all on table public.home_space_audit_events from anon;
revoke all on table public.home_space_audit_events from public;

grant select, insert on table public.home_space_snapshots to authenticated;
grant select, insert on table public.home_space_audit_events to authenticated;

drop policy if exists home_space_snapshots_select_own on public.home_space_snapshots;
create policy home_space_snapshots_select_own
on public.home_space_snapshots
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists home_space_snapshots_insert_own_account_managed on public.home_space_snapshots;
create policy home_space_snapshots_insert_own_account_managed
on public.home_space_snapshots
for insert
to authenticated
with check (
  user_id = auth.uid()
  and document_class = 'user-data'
  and exists (
    select 1
    from public.home_spaces hs
    where hs.id = home_space_id
      and hs.user_id = auth.uid()
      and hs.sync_space_id = sync_space_id
      and hs.access_mode = 'account-managed'
  )
);

drop policy if exists home_space_audit_events_select_own on public.home_space_audit_events;
create policy home_space_audit_events_select_own
on public.home_space_audit_events
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists home_space_audit_events_insert_own on public.home_space_audit_events;
create policy home_space_audit_events_insert_own
on public.home_space_audit_events
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    home_space_id is null
    or exists (
      select 1
      from public.home_spaces hs
      where hs.id = home_space_id
        and hs.user_id = auth.uid()
    )
  )
);

create or replace function public.assert_cloud_snapshot_payload(
  p_snapshot_source text,
  p_document_class text,
  p_content_fingerprint text,
  p_document_json jsonb,
  p_summary jsonb
)
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if p_snapshot_source not in (
    'account-managed-created',
    'cloud-baseline',
    'after-cloud-push',
    'after-cloud-force-push'
  ) then
    raise exception 'Invalid cloud snapshot source' using errcode = '22023';
  end if;

  if p_document_class not in ('system-default', 'system-blank', 'system-template', 'user-data') then
    raise exception 'Invalid document class' using errcode = '22023';
  end if;

  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception 'Invalid snapshot summary' using errcode = '22023';
  end if;

  if p_document_class = 'user-data' then
    if p_content_fingerprint is null or char_length(p_content_fingerprint) < 1 then
      raise exception 'Invalid content fingerprint' using errcode = '22023';
    end if;

    if p_document_json is null or jsonb_typeof(p_document_json) <> 'object' then
      raise exception 'Invalid document json' using errcode = '22023';
    end if;
  end if;
end;
$$;

revoke all on function public.assert_cloud_snapshot_payload(text, text, text, jsonb, jsonb) from public;

create or replace function public.trim_home_space_snapshots(p_home_space_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.home_space_snapshots
  where home_space_id = p_home_space_id
    and id in (
      select id
      from public.home_space_snapshots
      where home_space_id = p_home_space_id
      order by created_at desc, id desc
      offset 50
    );
$$;

revoke all on function public.trim_home_space_snapshots(uuid) from public;

create or replace function public.insert_home_space_audit_event(
  p_user_id uuid,
  p_home_space_id uuid,
  p_sync_space_id uuid,
  p_event_type text,
  p_severity text default 'info',
  p_before_revision integer default null,
  p_after_revision integer default null,
  p_snapshot_id uuid default null,
  p_document_class_before text default null,
  p_document_class_after text default null,
  p_summary_before jsonb default null,
  p_summary_after jsonb default null,
  p_actor_user_id uuid default null,
  p_client_device_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  insert into public.home_space_audit_events (
    user_id,
    home_space_id,
    sync_space_id,
    event_type,
    severity,
    before_revision,
    after_revision,
    snapshot_id,
    document_class_before,
    document_class_after,
    summary_before,
    summary_after,
    actor_user_id,
    client_device_id,
    metadata
  )
  values (
    p_user_id,
    p_home_space_id,
    p_sync_space_id,
    p_event_type,
    coalesce(p_severity, 'info'),
    p_before_revision,
    p_after_revision,
    p_snapshot_id,
    p_document_class_before,
    p_document_class_after,
    p_summary_before,
    p_summary_after,
    p_actor_user_id,
    p_client_device_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.insert_home_space_audit_event(
  uuid, uuid, uuid, text, text, integer, integer, uuid, text, text, jsonb, jsonb, uuid, text, jsonb
) from public;

create or replace function public.insert_account_managed_home_snapshot(
  p_user_id uuid,
  p_home_space_id uuid,
  p_sync_space_id uuid,
  p_revision integer,
  p_snapshot_source text,
  p_document_class text,
  p_content_fingerprint text,
  p_document_json jsonb,
  p_summary jsonb,
  p_actor_user_id uuid,
  p_client_device_id text,
  p_operation_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest_fingerprint text;
  v_snapshot_id uuid;
begin
  perform public.assert_cloud_snapshot_payload(
    p_snapshot_source,
    p_document_class,
    p_content_fingerprint,
    p_document_json,
    p_summary
  );

  if p_document_class <> 'user-data' then
    return null;
  end if;

  select content_fingerprint
  into v_latest_fingerprint
  from public.home_space_snapshots
  where home_space_id = p_home_space_id
  order by created_at desc, id desc
  limit 1;

  if v_latest_fingerprint = p_content_fingerprint then
    return null;
  end if;

  insert into public.home_space_snapshots (
    user_id,
    home_space_id,
    sync_space_id,
    revision,
    snapshot_source,
    document_class,
    content_fingerprint,
    document_json,
    summary,
    actor_user_id,
    client_device_id,
    operation_id
  )
  values (
    p_user_id,
    p_home_space_id,
    p_sync_space_id,
    p_revision,
    p_snapshot_source,
    'user-data',
    p_content_fingerprint,
    p_document_json,
    p_summary,
    p_actor_user_id,
    p_client_device_id,
    p_operation_id
  )
  returning id into v_snapshot_id;

  perform public.trim_home_space_snapshots(p_home_space_id);

  return v_snapshot_id;
end;
$$;

revoke all on function public.insert_account_managed_home_snapshot(
  uuid, uuid, uuid, integer, text, text, text, jsonb, jsonb, uuid, text, text
) from public;

create or replace function public.create_account_managed_home_space_v2(
  p_name text,
  p_access_token text,
  p_encryption_key text,
  p_document_ciphertext text,
  p_document_iv text,
  p_document_salt text,
  p_document_schema_version integer default 2,
  p_snapshot_source text default 'account-managed-created',
  p_document_class text default 'system-default',
  p_content_fingerprint text default '',
  p_document_json jsonb default null,
  p_summary jsonb default '{}'::jsonb,
  p_client_device_id text default null,
  p_operation_id text default null
)
returns table (
  home_space_id uuid,
  sync_space_id uuid,
  revision integer,
  updated_at timestamptz,
  snapshot_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_home_space_id uuid;
  v_sync_space_id uuid;
  v_revision integer;
  v_updated_at timestamptz;
  v_snapshot_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'Invalid home space name' using errcode = '22023';
  end if;

  perform public.assert_sync_payload(
    p_access_token,
    p_document_ciphertext,
    p_document_iv,
    p_document_salt,
    p_document_schema_version
  );

  perform public.assert_cloud_snapshot_payload(
    p_snapshot_source,
    p_document_class,
    p_content_fingerprint,
    p_document_json,
    p_summary
  );

  if p_access_token is null
    or char_length(p_access_token) < 32
    or char_length(p_access_token) > 512
    or p_access_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid managed access token' using errcode = '22023';
  end if;

  if p_encryption_key is null
    or char_length(p_encryption_key) < 32
    or char_length(p_encryption_key) > 512
    or p_encryption_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid managed encryption key' using errcode = '22023';
  end if;

  insert into public.sync_spaces (
    access_token_hash,
    document_ciphertext,
    document_iv,
    document_salt,
    document_schema_version
  )
  values (
    public.hash_sync_access_token(p_access_token),
    p_document_ciphertext,
    p_document_iv,
    p_document_salt,
    p_document_schema_version
  )
  returning id, sync_spaces.revision, sync_spaces.updated_at
  into v_sync_space_id, v_revision, v_updated_at;

  insert into public.home_spaces (
    user_id,
    sync_space_id,
    name,
    access_mode
  )
  values (
    v_user_id,
    v_sync_space_id,
    v_name,
    'account-managed'
  )
  returning id
  into v_home_space_id;

  insert into public.home_space_credentials (
    home_space_id,
    user_id,
    credential_type,
    access_token,
    encryption_key
  )
  values (
    v_home_space_id,
    v_user_id,
    'sync-space-v1',
    p_access_token,
    p_encryption_key
  );

  v_snapshot_id := public.insert_account_managed_home_snapshot(
    v_user_id,
    v_home_space_id,
    v_sync_space_id,
    v_revision,
    'account-managed-created',
    p_document_class,
    p_content_fingerprint,
    p_document_json,
    p_summary,
    v_user_id,
    p_client_device_id,
    p_operation_id
  );

  perform public.insert_home_space_audit_event(
    v_user_id,
    v_home_space_id,
    v_sync_space_id,
    'account_managed.created',
    case when p_document_class = 'user-data' then 'info' else 'warning' end,
    null,
    v_revision,
    v_snapshot_id,
    null,
    p_document_class,
    null,
    p_summary,
    v_user_id,
    p_client_device_id,
    jsonb_build_object(
      'snapshotSource', 'account-managed-created',
      'snapshotSaved', v_snapshot_id is not null
    )
  );

  home_space_id := v_home_space_id;
  sync_space_id := v_sync_space_id;
  revision := v_revision;
  updated_at := v_updated_at;
  snapshot_id := v_snapshot_id;
  return next;
end;
$$;

revoke all on function public.create_account_managed_home_space_v2(
  text, text, text, text, text, text, integer, text, text, text, jsonb, jsonb, text, text
) from public;
revoke all on function public.create_account_managed_home_space_v2(
  text, text, text, text, text, text, integer, text, text, text, jsonb, jsonb, text, text
) from anon;
grant execute on function public.create_account_managed_home_space_v2(
  text, text, text, text, text, text, integer, text, text, text, jsonb, jsonb, text, text
) to authenticated;

create or replace function public.migrate_sync_code_home_space_to_account_managed_v2(
  p_home_space_id uuid,
  p_access_token text,
  p_encryption_key text,
  p_snapshot_source text default 'cloud-baseline',
  p_document_class text default 'system-default',
  p_content_fingerprint text default '',
  p_document_json jsonb default null,
  p_summary jsonb default '{}'::jsonb,
  p_client_device_id text default null,
  p_operation_id text default null
)
returns table (
  status text,
  home_space_id uuid,
  sync_space_id uuid,
  access_mode text,
  updated_at timestamptz,
  snapshot_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_home_space public.home_spaces%rowtype;
  v_revision integer;
  v_snapshot_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_access_token is null
    or char_length(p_access_token) < 32
    or char_length(p_access_token) > 512
    or p_access_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid sync access token' using errcode = '22023';
  end if;

  if p_encryption_key is null
    or char_length(p_encryption_key) < 32
    or char_length(p_encryption_key) > 512
    or p_encryption_key !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'Invalid sync encryption key' using errcode = '22023';
  end if;

  perform public.assert_cloud_snapshot_payload(
    p_snapshot_source,
    p_document_class,
    p_content_fingerprint,
    p_document_json,
    p_summary
  );

  select *
  into v_home_space
  from public.home_spaces hs
  where hs.id = p_home_space_id
    and hs.user_id = v_user_id
  for update;

  if v_home_space.id is null then
    raise exception 'Home space not found for current account' using errcode = '28000';
  end if;

  if v_home_space.access_mode not in ('sync-code', 'account-managed') then
    raise exception 'Home space cannot be migrated to account-managed mode' using errcode = '22023';
  end if;

  select ss.revision
  into v_revision
  from public.sync_spaces ss
  where ss.id = v_home_space.sync_space_id
    and ss.access_token_hash = public.hash_sync_access_token(p_access_token)
    and ss.revoked_at is null
    and (ss.expires_at is null or ss.expires_at > now());

  if v_revision is null then
    raise exception 'Sync space not found or token invalid' using errcode = '28000';
  end if;

  if v_home_space.access_mode = 'sync-code' then
    update public.home_spaces
    set access_mode = 'account-managed'
    where id = v_home_space.id
      and user_id = v_user_id
    returning *
    into v_home_space;

    status := 'migrated';
  else
    status := 'already-managed';
  end if;

  update public.home_space_credentials hsc
  set
    access_token = p_access_token,
    encryption_key = p_encryption_key,
    revoked_at = null
  where hsc.home_space_id = v_home_space.id
    and hsc.user_id = v_user_id
    and hsc.credential_type = 'sync-space-v1'
    and hsc.revoked_at is null;

  if not found then
    insert into public.home_space_credentials (
      home_space_id,
      user_id,
      credential_type,
      access_token,
      encryption_key
    )
    values (
      v_home_space.id,
      v_user_id,
      'sync-space-v1',
      p_access_token,
      p_encryption_key
    );
  end if;

  v_snapshot_id := public.insert_account_managed_home_snapshot(
    v_user_id,
    v_home_space.id,
    v_home_space.sync_space_id,
    v_revision,
    'cloud-baseline',
    p_document_class,
    p_content_fingerprint,
    p_document_json,
    p_summary,
    v_user_id,
    p_client_device_id,
    p_operation_id
  );

  perform public.insert_home_space_audit_event(
    v_user_id,
    v_home_space.id,
    v_home_space.sync_space_id,
    'account_managed.migrated',
    case when p_document_class = 'user-data' then 'info' else 'warning' end,
    null,
    v_revision,
    v_snapshot_id,
    null,
    p_document_class,
    null,
    p_summary,
    v_user_id,
    p_client_device_id,
    jsonb_build_object(
      'status', status,
      'snapshotSource', 'cloud-baseline',
      'snapshotSaved', v_snapshot_id is not null
    )
  );

  home_space_id := v_home_space.id;
  sync_space_id := v_home_space.sync_space_id;
  access_mode := 'account-managed';
  updated_at := v_home_space.updated_at;
  snapshot_id := v_snapshot_id;
  return next;
end;
$$;

revoke all on function public.migrate_sync_code_home_space_to_account_managed_v2(
  uuid, text, text, text, text, text, jsonb, jsonb, text, text
) from public;
revoke all on function public.migrate_sync_code_home_space_to_account_managed_v2(
  uuid, text, text, text, text, text, jsonb, jsonb, text, text
) from anon;
grant execute on function public.migrate_sync_code_home_space_to_account_managed_v2(
  uuid, text, text, text, text, text, jsonb, jsonb, text, text
) to authenticated;

create or replace function public.push_account_managed_sync_space(
  p_space_id uuid,
  p_access_token text,
  p_base_revision integer,
  p_document_ciphertext text,
  p_document_iv text,
  p_document_salt text,
  p_document_schema_version integer default 2,
  p_snapshot_source text default 'after-cloud-push',
  p_document_class text default 'system-default',
  p_content_fingerprint text default '',
  p_document_json jsonb default null,
  p_summary jsonb default '{}'::jsonb,
  p_client_device_id text default null,
  p_operation_id text default null
)
returns table (
  status text,
  revision integer,
  remote_revision integer,
  updated_at timestamptz,
  snapshot_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_home_space public.home_spaces%rowtype;
  v_current_revision integer;
  v_current_updated_at timestamptz;
  v_next_revision integer;
  v_next_updated_at timestamptz;
  v_snapshot_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform public.assert_sync_payload(
    p_access_token,
    p_document_ciphertext,
    p_document_iv,
    p_document_salt,
    p_document_schema_version
  );

  perform public.assert_cloud_snapshot_payload(
    p_snapshot_source,
    p_document_class,
    p_content_fingerprint,
    p_document_json,
    p_summary
  );

  select hs.*
  into v_home_space
  from public.home_spaces hs
  join public.home_space_credentials hsc
    on hsc.home_space_id = hs.id
    and hsc.user_id = hs.user_id
    and hsc.credential_type = 'sync-space-v1'
    and hsc.revoked_at is null
  where hs.user_id = v_user_id
    and hs.sync_space_id = p_space_id
    and hs.access_mode = 'account-managed'
    and hsc.access_token = p_access_token
  limit 1;

  if v_home_space.id is null then
    raise exception 'Account-managed home space not found for current account' using errcode = '28000';
  end if;

  select ss.revision, ss.updated_at
  into v_current_revision, v_current_updated_at
  from public.sync_spaces ss
  where ss.id = p_space_id
    and ss.access_token_hash = public.hash_sync_access_token(p_access_token)
    and ss.revoked_at is null
    and (ss.expires_at is null or ss.expires_at > now())
  for update;

  if v_current_revision is null then
    raise exception 'Sync space not found or token invalid' using errcode = '28000';
  end if;

  if p_base_revision is null or p_base_revision <> v_current_revision then
    perform public.insert_home_space_audit_event(
      v_user_id,
      v_home_space.id,
      v_home_space.sync_space_id,
      'sync.account_managed_push_conflict',
      'warning',
      v_current_revision,
      null,
      null,
      null,
      p_document_class,
      null,
      p_summary,
      v_user_id,
      p_client_device_id,
      jsonb_build_object('snapshotSource', p_snapshot_source)
    );

    status := 'conflict';
    revision := v_current_revision;
    remote_revision := v_current_revision;
    updated_at := v_current_updated_at;
    snapshot_id := null;
    return next;
    return;
  end if;

  update public.sync_spaces
  set
    document_ciphertext = p_document_ciphertext,
    document_iv = p_document_iv,
    document_salt = p_document_salt,
    document_schema_version = p_document_schema_version,
    revision = public.next_sync_revision(sync_spaces.revision),
    updated_at = now()
  where id = p_space_id
  returning sync_spaces.revision, sync_spaces.updated_at
  into v_next_revision, v_next_updated_at;

  v_snapshot_id := public.insert_account_managed_home_snapshot(
    v_user_id,
    v_home_space.id,
    v_home_space.sync_space_id,
    v_next_revision,
    'after-cloud-push',
    p_document_class,
    p_content_fingerprint,
    p_document_json,
    p_summary,
    v_user_id,
    p_client_device_id,
    p_operation_id
  );

  perform public.insert_home_space_audit_event(
    v_user_id,
    v_home_space.id,
    v_home_space.sync_space_id,
    'sync.account_managed_push',
    case when p_document_class = 'user-data' then 'info' else 'warning' end,
    v_current_revision,
    v_next_revision,
    v_snapshot_id,
    null,
    p_document_class,
    null,
    p_summary,
    v_user_id,
    p_client_device_id,
    jsonb_build_object(
      'snapshotSource', 'after-cloud-push',
      'snapshotSaved', v_snapshot_id is not null
    )
  );

  status := 'ok';
  revision := v_next_revision;
  remote_revision := v_next_revision;
  updated_at := v_next_updated_at;
  snapshot_id := v_snapshot_id;
  return next;
end;
$$;

revoke all on function public.push_account_managed_sync_space(
  uuid, text, integer, text, text, text, integer, text, text, text, jsonb, jsonb, text, text
) from public;
revoke all on function public.push_account_managed_sync_space(
  uuid, text, integer, text, text, text, integer, text, text, text, jsonb, jsonb, text, text
) from anon;
grant execute on function public.push_account_managed_sync_space(
  uuid, text, integer, text, text, text, integer, text, text, text, jsonb, jsonb, text, text
) to authenticated;

create or replace function public.force_push_account_managed_sync_space(
  p_space_id uuid,
  p_access_token text,
  p_document_ciphertext text,
  p_document_iv text,
  p_document_salt text,
  p_document_schema_version integer default 2,
  p_snapshot_source text default 'after-cloud-force-push',
  p_document_class text default 'system-default',
  p_content_fingerprint text default '',
  p_document_json jsonb default null,
  p_summary jsonb default '{}'::jsonb,
  p_client_device_id text default null,
  p_operation_id text default null
)
returns table (
  status text,
  revision integer,
  updated_at timestamptz,
  snapshot_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_home_space public.home_spaces%rowtype;
  v_current_revision integer;
  v_next_revision integer;
  v_next_updated_at timestamptz;
  v_snapshot_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform public.assert_sync_payload(
    p_access_token,
    p_document_ciphertext,
    p_document_iv,
    p_document_salt,
    p_document_schema_version
  );

  perform public.assert_cloud_snapshot_payload(
    p_snapshot_source,
    p_document_class,
    p_content_fingerprint,
    p_document_json,
    p_summary
  );

  select hs.*
  into v_home_space
  from public.home_spaces hs
  join public.home_space_credentials hsc
    on hsc.home_space_id = hs.id
    and hsc.user_id = hs.user_id
    and hsc.credential_type = 'sync-space-v1'
    and hsc.revoked_at is null
  where hs.user_id = v_user_id
    and hs.sync_space_id = p_space_id
    and hs.access_mode = 'account-managed'
    and hsc.access_token = p_access_token
  limit 1;

  if v_home_space.id is null then
    raise exception 'Account-managed home space not found for current account' using errcode = '28000';
  end if;

  select ss.revision
  into v_current_revision
  from public.sync_spaces ss
  where ss.id = p_space_id
    and ss.access_token_hash = public.hash_sync_access_token(p_access_token)
    and ss.revoked_at is null
    and (ss.expires_at is null or ss.expires_at > now())
  for update;

  if v_current_revision is null then
    raise exception 'Sync space not found or token invalid' using errcode = '28000';
  end if;

  update public.sync_spaces
  set
    document_ciphertext = p_document_ciphertext,
    document_iv = p_document_iv,
    document_salt = p_document_salt,
    document_schema_version = p_document_schema_version,
    revision = public.next_sync_revision(sync_spaces.revision),
    updated_at = now()
  where id = p_space_id
  returning sync_spaces.revision, sync_spaces.updated_at
  into v_next_revision, v_next_updated_at;

  v_snapshot_id := public.insert_account_managed_home_snapshot(
    v_user_id,
    v_home_space.id,
    v_home_space.sync_space_id,
    v_next_revision,
    'after-cloud-force-push',
    p_document_class,
    p_content_fingerprint,
    p_document_json,
    p_summary,
    v_user_id,
    p_client_device_id,
    p_operation_id
  );

  perform public.insert_home_space_audit_event(
    v_user_id,
    v_home_space.id,
    v_home_space.sync_space_id,
    'sync.account_managed_force_push',
    'warning',
    v_current_revision,
    v_next_revision,
    v_snapshot_id,
    null,
    p_document_class,
    null,
    p_summary,
    v_user_id,
    p_client_device_id,
    jsonb_build_object(
      'snapshotSource', 'after-cloud-force-push',
      'snapshotSaved', v_snapshot_id is not null
    )
  );

  status := 'ok';
  revision := v_next_revision;
  updated_at := v_next_updated_at;
  snapshot_id := v_snapshot_id;
  return next;
end;
$$;

revoke all on function public.force_push_account_managed_sync_space(
  uuid, text, text, text, text, integer, text, text, text, jsonb, jsonb, text, text
) from public;
revoke all on function public.force_push_account_managed_sync_space(
  uuid, text, text, text, text, integer, text, text, text, jsonb, jsonb, text, text
) from anon;
grant execute on function public.force_push_account_managed_sync_space(
  uuid, text, text, text, text, integer, text, text, text, jsonb, jsonb, text, text
) to authenticated;

commit;
