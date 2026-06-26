begin;

-- Phase 1.11.9: privacy-first client error monitoring.
-- The frontend can only call record_client_error_event(...); direct table access is not granted.

create or replace function public.client_error_event_type_allowed(p_event_type text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_event_type in (
    'react_render_error',
    'window_error',
    'unhandled_rejection',
    'resource_load_failed',
    'async_operation_failed'
  );
$$;

revoke all on function public.client_error_event_type_allowed(text) from public, anon, authenticated;

create or replace function public.client_error_json_has_forbidden_key(p_value jsonb)
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

      if public.client_error_json_has_forbidden_key(v_value) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_value in select value from jsonb_array_elements(p_value) loop
      if public.client_error_json_has_forbidden_key(v_value) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

revoke all on function public.client_error_json_has_forbidden_key(jsonb) from public, anon, authenticated;

create or replace function public.client_error_properties_allowed(p_properties jsonb)
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
      'documentClass',
      'hasSyncBinding',
      'online',
      'reasonCode',
      'resourceKind',
      'resourceOriginKind',
      'runtime',
      'source',
      'sourceKind',
      'storageReady',
      'supabaseConfigured',
      'syncStatus',
      'visibilityState'
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

revoke all on function public.client_error_properties_allowed(jsonb) from public, anon, authenticated;

create table if not exists public.client_error_events (
  id uuid primary key default extensions.gen_random_uuid(),
  event_type text not null,
  severity text not null,
  schema_version integer not null default 1,
  fingerprint text not null,
  anonymous_id text not null,
  session_id text,
  user_state text not null,
  page_path text,
  operation text,
  error_name text,
  message_sanitized text not null,
  stack_sanitized text,
  component_stack_sanitized text,
  properties jsonb not null default '{}'::jsonb,
  app_version text,
  client_created_at timestamptz,
  created_at timestamptz not null default now(),
  constraint client_error_events_event_type_valid check (public.client_error_event_type_allowed(event_type)),
  constraint client_error_events_severity_valid check (severity in ('info', 'warning', 'error', 'fatal')),
  constraint client_error_events_schema_version_valid check (schema_version = 1),
  constraint client_error_events_fingerprint_valid check (
    char_length(fingerprint) between 5 and 80
    and fingerprint ~ '^err-[a-z0-9-]+$'
  ),
  constraint client_error_events_anonymous_id_valid check (
    char_length(anonymous_id) between 12 and 180
    and anonymous_id ~ '^diag-[a-z0-9-]+$'
  ),
  constraint client_error_events_session_id_valid check (
    session_id is null
    or (
      char_length(session_id) between 12 and 180
      and session_id ~ '^session-[a-z0-9-]+$'
    )
  ),
  constraint client_error_events_user_state_valid check (user_state in ('anonymous', 'signed-in')),
  constraint client_error_events_page_path_size check (page_path is null or char_length(page_path) <= 160),
  constraint client_error_events_operation_size check (operation is null or char_length(operation) <= 96),
  constraint client_error_events_error_name_size check (error_name is null or char_length(error_name) <= 80),
  constraint client_error_events_message_size check (char_length(message_sanitized) <= 500),
  constraint client_error_events_stack_size check (stack_sanitized is null or char_length(stack_sanitized) <= 3000),
  constraint client_error_events_component_stack_size check (component_stack_sanitized is null or char_length(component_stack_sanitized) <= 2000),
  constraint client_error_events_app_version_size check (app_version is null or char_length(app_version) <= 80),
  constraint client_error_events_properties_object check (jsonb_typeof(properties) = 'object'),
  constraint client_error_events_properties_size check (octet_length(properties::text) <= 4096),
  constraint client_error_events_properties_allowed check (public.client_error_properties_allowed(properties)),
  constraint client_error_events_properties_no_forbidden_keys check (not public.client_error_json_has_forbidden_key(properties))
);

create index if not exists client_error_events_created_idx
  on public.client_error_events(created_at desc);
create index if not exists client_error_events_fingerprint_created_idx
  on public.client_error_events(fingerprint, created_at desc);
create index if not exists client_error_events_type_created_idx
  on public.client_error_events(event_type, created_at desc);
create index if not exists client_error_events_anonymous_created_idx
  on public.client_error_events(anonymous_id, created_at desc);

alter table public.client_error_events enable row level security;

revoke all on table public.client_error_events from public;
revoke all on table public.client_error_events from anon;
revoke all on table public.client_error_events from authenticated;

create or replace function public.record_client_error_event(
  p_event_type text,
  p_severity text default 'error',
  p_schema_version integer default 1,
  p_fingerprint text default null,
  p_anonymous_id text default null,
  p_session_id text default null,
  p_page_path text default null,
  p_operation text default null,
  p_error_name text default null,
  p_message_sanitized text default null,
  p_stack_sanitized text default null,
  p_component_stack_sanitized text default null,
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
  if not public.client_error_event_type_allowed(p_event_type) then
    raise exception 'Invalid client error event type' using errcode = '22023';
  end if;

  if p_severity not in ('info', 'warning', 'error', 'fatal') then
    raise exception 'Invalid client error severity' using errcode = '22023';
  end if;

  if p_schema_version <> 1 then
    raise exception 'Invalid client error schema version' using errcode = '22023';
  end if;

  if p_fingerprint is null
    or char_length(p_fingerprint) < 5
    or char_length(p_fingerprint) > 80
    or p_fingerprint !~ '^err-[a-z0-9-]+$' then
    raise exception 'Invalid client error fingerprint' using errcode = '22023';
  end if;

  if p_anonymous_id is null
    or char_length(p_anonymous_id) < 12
    or char_length(p_anonymous_id) > 180
    or p_anonymous_id !~ '^diag-[a-z0-9-]+$' then
    raise exception 'Invalid client error anonymous id' using errcode = '22023';
  end if;

  if p_session_id is not null
    and (
      char_length(p_session_id) < 12
      or char_length(p_session_id) > 180
      or p_session_id !~ '^session-[a-z0-9-]+$'
    ) then
    raise exception 'Invalid client error session id' using errcode = '22023';
  end if;

  if p_message_sanitized is null
    or char_length(p_message_sanitized) > 500 then
    raise exception 'Invalid client error message' using errcode = '22023';
  end if;

  if p_stack_sanitized is not null and char_length(p_stack_sanitized) > 3000 then
    raise exception 'Invalid client error stack' using errcode = '22023';
  end if;

  if p_component_stack_sanitized is not null and char_length(p_component_stack_sanitized) > 2000 then
    raise exception 'Invalid client error component stack' using errcode = '22023';
  end if;

  if jsonb_typeof(v_properties) <> 'object'
    or octet_length(v_properties::text) > 4096
    or not public.client_error_properties_allowed(v_properties)
    or public.client_error_json_has_forbidden_key(v_properties) then
    raise exception 'Invalid client error properties' using errcode = '22023';
  end if;

  insert into public.client_error_events (
    event_type,
    severity,
    schema_version,
    fingerprint,
    anonymous_id,
    session_id,
    user_state,
    page_path,
    operation,
    error_name,
    message_sanitized,
    stack_sanitized,
    component_stack_sanitized,
    properties,
    app_version,
    client_created_at
  )
  values (
    p_event_type,
    p_severity,
    1,
    p_fingerprint,
    p_anonymous_id,
    p_session_id,
    case when auth.uid() is null then 'anonymous' else 'signed-in' end,
    nullif(left(coalesce(p_page_path, ''), 160), ''),
    nullif(left(coalesce(p_operation, ''), 96), ''),
    nullif(left(coalesce(p_error_name, ''), 80), ''),
    left(p_message_sanitized, 500),
    nullif(left(coalesce(p_stack_sanitized, ''), 3000), ''),
    nullif(left(coalesce(p_component_stack_sanitized, ''), 2000), ''),
    v_properties,
    nullif(left(coalesce(p_app_version, ''), 80), ''),
    p_client_created_at
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

revoke all on function public.record_client_error_event(
  text, text, integer, text, text, text, text, text, text, text, text, text, jsonb, timestamptz, text
) from public;
grant execute on function public.record_client_error_event(
  text, text, integer, text, text, text, text, text, text, text, text, text, jsonb, timestamptz, text
) to anon, authenticated;

create or replace function public.delete_client_error_events_older_than(p_retention_days integer default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_retention_days is null or p_retention_days < 30 or p_retention_days > 730 then
    raise exception 'Invalid client error retention window' using errcode = '22023';
  end if;

  delete from public.client_error_events
  where created_at < now() - make_interval(days => p_retention_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.delete_client_error_events_older_than(integer) from public, anon, authenticated;

commit;
