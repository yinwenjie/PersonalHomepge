begin;

-- Phase 1.18.5 prerequisite: bounded reads for admin-read.
-- home_space_snapshots.content_fingerprint and summary, home_space_audit_events
-- summary_*/metadata/event_type and profiles.display_name have no length limit and their
-- owner can write them directly. admin-read used to fetch these columns raw and project
-- them in the Edge Function, so one user could make the administrator views of their own
-- data fail. These functions project in the database and return only bounded values:
-- the Edge Function never receives the raw columns. Only the service role may call them.
--
-- The readers run as their owner because service_role has no table privileges on
-- profiles, home_space_snapshots or home_space_audit_events (newer Supabase projects no
-- longer grant them by default), and admin-read should not need any. home_spaces gets an
-- explicit column grant for the metadata admin-read lists.

-- Keeps the six summary fields admin-read shows, each only in its expected shape. Counts
-- are rebuilt as integers: a stored numeric can carry thousands of fractional digits.
create or replace function public.admin_project_snapshot_summary(p_summary jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_summary is null or jsonb_typeof(p_summary) <> 'object' then null
    else jsonb_build_object(
      'groupCount', case
        when jsonb_typeof(p_summary -> 'groupCount') = 'number'
          and (p_summary -> 'groupCount')::numeric between 0 and 1000000
          and (p_summary -> 'groupCount')::numeric = trunc((p_summary -> 'groupCount')::numeric)
          then to_jsonb((p_summary -> 'groupCount')::numeric::integer)
      end,
      'siteCount', case
        when jsonb_typeof(p_summary -> 'siteCount') = 'number'
          and (p_summary -> 'siteCount')::numeric between 0 and 1000000
          and (p_summary -> 'siteCount')::numeric = trunc((p_summary -> 'siteCount')::numeric)
          then to_jsonb((p_summary -> 'siteCount')::numeric::integer)
      end,
      'widgetCount', case
        when jsonb_typeof(p_summary -> 'widgetCount') = 'number'
          and (p_summary -> 'widgetCount')::numeric between 0 and 1000000
          and (p_summary -> 'widgetCount')::numeric = trunc((p_summary -> 'widgetCount')::numeric)
          then to_jsonb((p_summary -> 'widgetCount')::numeric::integer)
      end,
      'themePresetId', case
        when jsonb_typeof(p_summary -> 'themePresetId') = 'string'
          and char_length(p_summary ->> 'themePresetId') <= 40
          then p_summary -> 'themePresetId'
      end,
      'hasBanner', case
        when jsonb_typeof(p_summary -> 'hasBanner') = 'boolean' then p_summary -> 'hasBanner'
      end,
      'hasBackground', case
        when jsonb_typeof(p_summary -> 'hasBackground') = 'boolean'
          then p_summary -> 'hasBackground'
      end
    )
  end;
$$;

create or replace function public.admin_read_profile(p_user_id uuid)
returns table (id uuid, display_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, left(p.display_name, 80), p.created_at
  from public.profiles as p
  where p.id = p_user_id;
$$;

-- Snapshot summaries of one space, newest first, keyset paged on (created_at, id).
-- The fingerprint leaves the database only as the first 12 hex characters of its SHA-256.
create or replace function public.admin_list_snapshots(
  p_user_id uuid,
  p_home_space_id uuid,
  p_after_created_at timestamptz,
  p_after_id uuid,
  p_limit integer
)
returns table (
  id uuid,
  revision integer,
  snapshot_source text,
  fingerprint_digest text,
  summary jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.revision,
    s.snapshot_source,
    left(encode(sha256(convert_to(s.content_fingerprint, 'UTF8')), 'hex'), 12),
    public.admin_project_snapshot_summary(s.summary),
    s.created_at
  from public.home_space_snapshots as s
  where s.user_id = p_user_id
    and s.home_space_id = p_home_space_id
    and (
      p_after_created_at is null
      or (p_after_id is not null and (s.created_at, s.id) < (p_after_created_at, p_after_id))
    )
  order by s.created_at desc, s.id desc
  limit least(greatest(coalesce(p_limit, 1), 1), 51);
$$;

-- User-side cloud audit events, newest first. metadata keeps only short snapshotSource,
-- source and snapshotSaved values; an over-long event_type becomes 'other'.
create or replace function public.admin_list_home_audit_events(
  p_user_id uuid,
  p_home_space_id uuid,
  p_after_created_at timestamptz,
  p_after_id uuid,
  p_limit integer
)
returns table (
  id uuid,
  home_space_id uuid,
  event_type text,
  severity text,
  before_revision integer,
  after_revision integer,
  snapshot_id uuid,
  summary_before jsonb,
  summary_after jsonb,
  metadata jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.home_space_id,
    case when char_length(e.event_type) <= 64 then e.event_type else 'other' end,
    e.severity,
    e.before_revision,
    e.after_revision,
    e.snapshot_id,
    public.admin_project_snapshot_summary(e.summary_before),
    public.admin_project_snapshot_summary(e.summary_after),
    jsonb_strip_nulls(jsonb_build_object(
      'snapshotSource', case
        when jsonb_typeof(e.metadata -> 'snapshotSource') = 'string'
          and char_length(e.metadata ->> 'snapshotSource') <= 64
          then e.metadata -> 'snapshotSource'
      end,
      'source', case
        when jsonb_typeof(e.metadata -> 'source') = 'string'
          and char_length(e.metadata ->> 'source') <= 64
          then e.metadata -> 'source'
      end,
      'snapshotSaved', case
        when jsonb_typeof(e.metadata -> 'snapshotSaved') = 'boolean'
          then e.metadata -> 'snapshotSaved'
      end
    )),
    e.created_at
  from public.home_space_audit_events as e
  where e.user_id = p_user_id
    and (p_home_space_id is null or e.home_space_id = p_home_space_id)
    and (
      p_after_created_at is null
      or (p_after_id is not null and (e.created_at, e.id) < (p_after_created_at, p_after_id))
    )
  order by e.created_at desc, e.id desc
  limit least(greatest(coalesce(p_limit, 1), 1), 51);
$$;

revoke all on function public.admin_project_snapshot_summary(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_read_profile(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_snapshots(uuid, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_home_audit_events(uuid, uuid, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;

grant select (
  id, user_id, sync_space_id, name, access_mode, is_default, created_at, updated_at, last_used_at
) on table public.home_spaces to service_role;

grant execute on function public.admin_project_snapshot_summary(jsonb) to service_role;
grant execute on function public.admin_read_profile(uuid) to service_role;
grant execute on function public.admin_list_snapshots(uuid, uuid, timestamptz, uuid, integer)
  to service_role;
grant execute on function public.admin_list_home_audit_events(uuid, uuid, timestamptz, uuid, integer)
  to service_role;

commit;
