begin;

-- Phase 1.11.8: privacy-first product analytics.
-- The frontend can only call record_product_event(...); direct table access is not granted.

create or replace function public.product_analytics_event_allowed(p_event_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_event_name in (
    'home.viewed',
    'settings.opened',
    'search.submitted',
    'template.applied',
    'theme.changed',
    'theme_image.changed',
    'widget.added',
    'group.added',
    'site.added',
    'bookmark_import.opened',
    'bookmark_import.parsed',
    'bookmark_import.completed',
    'bookmark_import.failed',
    'data_package.exported',
    'data_package.restore_previewed',
    'data_package.restore_failed',
    'data_package.restored',
    'document.json_exported',
    'document.json_imported',
    'document.json_import_failed',
    'document.reset_default',
    'document.reset_backup_restored',
    'recovery.center_opened',
    'recovery.local_previewed',
    'recovery.local_restored',
    'recovery.cloud_previewed',
    'recovery.cloud_restored',
    'auth.magic_link_requested',
    'auth.magic_link_failed',
    'auth.signed_in',
    'auth.signed_out',
    'sync.code_created',
    'sync.code_bound',
    'sync.pull_applied',
    'sync.push_applied',
    'sync.conflict_detected',
    'sync.resolved_cloud',
    'sync.resolved_local',
    'sync.auto_push_skipped_system_document',
    'home_space.claimed',
    'home_space.sync_code_activated',
    'home_space.account_managed_created',
    'home_space.account_managed_template_created',
    'home_space.account_managed_restored',
    'home_space.sync_code_migrated',
    'home_space.removed',
    'account.preferences_updated',
    'analytics.preference_changed'
  );
$$;

revoke all on function public.product_analytics_event_allowed(text) from public, anon, authenticated;

create or replace function public.product_analytics_json_has_forbidden_key(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_value jsonb;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_value in select key, value from jsonb_each(p_value) loop
      if lower(v_key) in (
        'accesstoken',
        'access_token',
        'authorization',
        'document',
        'documentjson',
        'document_json',
        'email',
        'encryptionkey',
        'encryption_key',
        'groupname',
        'grouptitle',
        'homepage',
        'homedocument',
        'imageurl',
        'password',
        'query',
        'refreshtoken',
        'refresh_token',
        'searchterm',
        'secret',
        'session',
        'sitename',
        'synccode',
        'sync_code',
        'todo',
        'token',
        'url',
        'useremail',
        'userid'
      ) then
        return true;
      end if;

      if public.product_analytics_json_has_forbidden_key(v_value) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_value in select value from jsonb_array_elements(p_value) loop
      if public.product_analytics_json_has_forbidden_key(v_value) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

revoke all on function public.product_analytics_json_has_forbidden_key(jsonb) from public, anon, authenticated;

create or replace function public.product_analytics_properties_allowed(p_properties jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_value jsonb;
  v_child jsonb;
  v_type text;
begin
  if p_properties is null or jsonb_typeof(p_properties) <> 'object' then
    return false;
  end if;

  for v_key, v_value in select key, value from jsonb_each(p_properties) loop
    if v_key not in (
      'accessMode',
      'assetSlot',
      'assetSource',
      'cloudHistoryAvailable',
      'documentClass',
      'force',
      'groupCountBucket',
      'hasBanner',
      'hasBackground',
      'hasStoredDocument',
      'hasSyncBinding',
      'reasonCode',
      'result',
      'searchEngine',
      'signedIn',
      'siteCountBucket',
      'source',
      'sourceKind',
      'storageReady',
      'syncStatus',
      'templateId',
      'themePresetId',
      'widgetCountBucket',
      'widgetType'
    ) then
      return false;
    end if;

    v_type := jsonb_typeof(v_value);
    if v_type not in ('string', 'number', 'boolean', 'null', 'array') then
      return false;
    end if;

    if v_type = 'array' then
      if jsonb_array_length(v_value) > 24 then
        return false;
      end if;

      for v_child in select value from jsonb_array_elements(v_value) loop
        if jsonb_typeof(v_child) not in ('string', 'number', 'boolean', 'null') then
          return false;
        end if;
      end loop;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.product_analytics_properties_allowed(jsonb) from public, anon, authenticated;

create table if not exists public.product_analytics_events (
  id uuid primary key default extensions.gen_random_uuid(),
  event_name text not null,
  schema_version integer not null default 1,
  anonymous_id text not null,
  session_id text,
  user_state text not null,
  page_path text,
  referrer_origin text,
  properties jsonb not null default '{}'::jsonb,
  app_version text,
  client_created_at timestamptz,
  created_at timestamptz not null default now(),
  constraint product_analytics_events_event_name_valid check (public.product_analytics_event_allowed(event_name)),
  constraint product_analytics_events_schema_version_valid check (schema_version = 1),
  constraint product_analytics_events_anonymous_id_valid check (
    char_length(anonymous_id) between 12 and 180
    and anonymous_id ~ '^anon-[a-z0-9-]+$'
  ),
  constraint product_analytics_events_session_id_valid check (
    session_id is null
    or (
      char_length(session_id) between 12 and 180
      and session_id ~ '^session-[a-z0-9-]+$'
    )
  ),
  constraint product_analytics_events_user_state_valid check (user_state in ('anonymous', 'signed-in')),
  constraint product_analytics_events_page_path_size check (page_path is null or char_length(page_path) <= 160),
  constraint product_analytics_events_referrer_origin_size check (referrer_origin is null or char_length(referrer_origin) <= 160),
  constraint product_analytics_events_app_version_size check (app_version is null or char_length(app_version) <= 80),
  constraint product_analytics_events_properties_object check (jsonb_typeof(properties) = 'object'),
  constraint product_analytics_events_properties_size check (octet_length(properties::text) <= 4096),
  constraint product_analytics_events_properties_allowed check (public.product_analytics_properties_allowed(properties)),
  constraint product_analytics_events_properties_no_forbidden_keys check (not public.product_analytics_json_has_forbidden_key(properties))
);

create index if not exists product_analytics_events_created_idx
  on public.product_analytics_events(created_at desc);
create index if not exists product_analytics_events_name_created_idx
  on public.product_analytics_events(event_name, created_at desc);
create index if not exists product_analytics_events_anonymous_created_idx
  on public.product_analytics_events(anonymous_id, created_at desc);

alter table public.product_analytics_events enable row level security;

revoke all on table public.product_analytics_events from public;
revoke all on table public.product_analytics_events from anon;
revoke all on table public.product_analytics_events from authenticated;

create or replace function public.record_product_event(
  p_event_name text,
  p_schema_version integer default 1,
  p_anonymous_id text default null,
  p_session_id text default null,
  p_page_path text default null,
  p_referrer_origin text default null,
  p_properties jsonb default '{}'::jsonb,
  p_client_created_at timestamptz default null,
  p_app_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
  v_properties jsonb := coalesce(p_properties, '{}'::jsonb);
begin
  if not public.product_analytics_event_allowed(p_event_name) then
    raise exception 'Invalid analytics event name' using errcode = '22023';
  end if;

  if p_schema_version <> 1 then
    raise exception 'Invalid analytics schema version' using errcode = '22023';
  end if;

  if p_anonymous_id is null
    or char_length(p_anonymous_id) < 12
    or char_length(p_anonymous_id) > 180
    or p_anonymous_id !~ '^anon-[a-z0-9-]+$' then
    raise exception 'Invalid analytics anonymous id' using errcode = '22023';
  end if;

  if p_session_id is not null
    and (
      char_length(p_session_id) < 12
      or char_length(p_session_id) > 180
      or p_session_id !~ '^session-[a-z0-9-]+$'
    ) then
    raise exception 'Invalid analytics session id' using errcode = '22023';
  end if;

  if jsonb_typeof(v_properties) <> 'object'
    or octet_length(v_properties::text) > 4096
    or not public.product_analytics_properties_allowed(v_properties)
    or public.product_analytics_json_has_forbidden_key(v_properties) then
    raise exception 'Invalid analytics properties' using errcode = '22023';
  end if;

  insert into public.product_analytics_events (
    event_name,
    schema_version,
    anonymous_id,
    session_id,
    user_state,
    page_path,
    referrer_origin,
    properties,
    app_version,
    client_created_at
  )
  values (
    p_event_name,
    1,
    p_anonymous_id,
    p_session_id,
    case when auth.uid() is null then 'anonymous' else 'signed-in' end,
    nullif(left(coalesce(p_page_path, ''), 160), ''),
    nullif(left(coalesce(p_referrer_origin, ''), 160), ''),
    v_properties,
    nullif(left(coalesce(p_app_version, ''), 80), ''),
    p_client_created_at
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.record_product_event(
  text, integer, text, text, text, text, jsonb, timestamptz, text
) from public;
grant execute on function public.record_product_event(
  text, integer, text, text, text, text, jsonb, timestamptz, text
) to anon, authenticated;

create or replace function public.delete_product_analytics_events_older_than(p_retention_days integer default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_retention_days is null or p_retention_days < 30 or p_retention_days > 730 then
    raise exception 'Invalid analytics retention window' using errcode = '22023';
  end if;

  delete from public.product_analytics_events
  where created_at < now() - make_interval(days => p_retention_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_product_analytics_events_older_than(integer) from public, anon, authenticated;

commit;
