begin;

-- Phase 2.2 RSS widget server side (docs/implementation/phase-2/Phase2_2_RssWidgetDesign.md).
-- Only the rss-proxy Edge Function touches these objects, with the service role:
-- RLS is on with no policies, and anon/authenticated get no table or function access.

-- Shared, user-agnostic cache: one row per normalized feed URL.
create table public.rss_feed_cache (
  url_hash text primary key,
  feed_url text not null,
  status text not null default 'pending',
  error_code text,
  title text,
  site_url text,
  items jsonb not null default '[]'::jsonb,
  etag text,
  last_modified text,
  failure_count integer not null default 0,
  fetched_at timestamptz,
  next_fetch_at timestamptz not null default now(),
  refresh_lease_until timestamptz,
  -- Identifies the current lease holder; only it may finish or release the refresh.
  refresh_lease_token uuid,
  last_requested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint rss_feed_cache_url_hash_valid check (url_hash ~ '^[0-9a-f]{64}$'),
  constraint rss_feed_cache_feed_url_valid check (
    char_length(feed_url) between 1 and 2048 and feed_url ~ '^https?://'
  ),
  constraint rss_feed_cache_status_valid check (status in ('pending', 'ok', 'error')),
  constraint rss_feed_cache_error_code_valid check (
    error_code is null or error_code in (
      'not_feed', 'fetch_failed', 'timeout', 'too_large', 'blocked_address'
    )
  ),
  constraint rss_feed_cache_title_size check (title is null or char_length(title) <= 200),
  constraint rss_feed_cache_site_url_size check (site_url is null or char_length(site_url) <= 2048),
  -- The function keeps compact JSON under 64 KB; jsonb::text adds spaces, so allow headroom.
  constraint rss_feed_cache_items_valid check (
    jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) <= 20
    and octet_length(items::text) <= 131072
  ),
  constraint rss_feed_cache_etag_size check (etag is null or char_length(etag) <= 512),
  constraint rss_feed_cache_last_modified_size check (
    last_modified is null or char_length(last_modified) <= 128
  ),
  constraint rss_feed_cache_failure_count_valid check (failure_count >= 0)
);

create index rss_feed_cache_last_requested_idx on public.rss_feed_cache (last_requested_at);

-- Fixed-window request counters. bucket_key is a keyed hash, never a raw IP.
create table public.rss_rate_limits (
  bucket_key text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (bucket_key, window_start),
  constraint rss_rate_limits_bucket_key_size check (char_length(bucket_key) between 1 and 128),
  constraint rss_rate_limits_request_count_valid check (request_count >= 0)
);

create index rss_rate_limits_window_start_idx on public.rss_rate_limits (window_start);

alter table public.rss_feed_cache enable row level security;
alter table public.rss_rate_limits enable row level security;

revoke all on table public.rss_feed_cache from public, anon, authenticated;
revoke all on table public.rss_rate_limits from public, anon, authenticated;

grant select, insert, update, delete on table public.rss_feed_cache to service_role;
grant select, insert, update, delete on table public.rss_rate_limits to service_role;

-- Counts one request in the current fixed window and reports whether it is within p_limit.
create or replace function public.rss_consume_rate(
  p_bucket_key text,
  p_window_seconds integer,
  p_limit integer
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_bucket_key is null or char_length(p_bucket_key) not between 1 and 128 then
    raise exception 'invalid rate limit bucket' using errcode = '22023';
  end if;

  if p_window_seconds is null or p_window_seconds not between 1 and 86400
    or p_limit is null or p_limit < 1 then
    raise exception 'invalid rate limit window' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rss_rate_limits as r (bucket_key, window_start, request_count)
  values (p_bucket_key, v_window_start, 1)
  on conflict (bucket_key, window_start)
  do update set request_count = r.request_count + 1
  returning r.request_count into v_count;

  return v_count <= p_limit;
end;
$$;

-- Lets exactly one caller refresh a due feed: creates a pending row for a new feed, then
-- takes a short lease only when the row is due and nobody else holds an unexpired lease.
-- Returns the lease token, or null when the caller did not get the lease. Taking over an
-- expired lease issues a new token, so a late former holder can no longer write.
create or replace function public.rss_claim_refresh(
  p_url_hash text,
  p_feed_url text,
  p_lease_seconds integer default 60
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_token uuid;
begin
  if p_lease_seconds is null or p_lease_seconds not between 1 and 300 then
    raise exception 'invalid lease' using errcode = '22023';
  end if;

  insert into public.rss_feed_cache (url_hash, feed_url)
  values (p_url_hash, p_feed_url)
  on conflict (url_hash) do nothing;

  update public.rss_feed_cache
  set refresh_lease_until = now() + make_interval(secs => p_lease_seconds),
    refresh_lease_token = gen_random_uuid()
  where url_hash = p_url_hash
    and next_fetch_at <= now()
    and (refresh_lease_until is null or refresh_lease_until < now())
  returning refresh_lease_token into v_token;

  return v_token;
end;
$$;

-- Housekeeping: feeds nobody asked for in p_unused_days, and rate windows older than a day.
create or replace function public.delete_stale_rss_feed_cache(p_unused_days integer default 30)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_unused_days is null or p_unused_days < 1 then
    raise exception 'invalid retention' using errcode = '22023';
  end if;

  -- A row whose refresh is in flight belongs to a returning reader; keep it.
  delete from public.rss_feed_cache
  where last_requested_at < now() - make_interval(days => p_unused_days)
    and (refresh_lease_until is null or refresh_lease_until < now());
  get diagnostics v_deleted = row_count;

  delete from public.rss_rate_limits
  where window_start < now() - interval '1 day';

  return v_deleted;
end;
$$;

revoke all on function public.rss_consume_rate(text, integer, integer) from public, anon, authenticated;
revoke all on function public.rss_claim_refresh(text, text, integer) from public, anon, authenticated;
revoke all on function public.delete_stale_rss_feed_cache(integer) from public, anon, authenticated;

grant execute on function public.rss_consume_rate(text, integer, integer) to service_role;
grant execute on function public.rss_claim_refresh(text, text, integer) to service_role;
grant execute on function public.delete_stale_rss_feed_cache(integer) to service_role;

-- RSS analytics: rss.feed_checked with result and the new discovered property.
-- Both functions only widen their allowlists, so existing rows still satisfy the
-- check constraints that call them.

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
    'analytics.preference_changed',
    'homepage_guide.opened',
    'homepage_guide.address_copied',
    'homepage_guide.tip_dismissed',
    'rss.feed_checked'
  );
$$;

revoke all on function public.product_analytics_event_allowed(text) from public, anon, authenticated;

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
      'browserFamily',
      'cloudHistoryAvailable',
      'discovered',
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

commit;
