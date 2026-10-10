begin;

-- Phase 1.18 user directory and statistics for admin-read (owner decision 2026-10-10).
-- Replaces the original "no user list" boundary with a masked one: owners and admins can
-- page through users, but an email leaves the database only masked (first character of
-- the local part plus the domain). The full address still needs an exact resolve-user
-- lookup, which is audited per user. Statistics are aggregate counts only.
-- Only the service role (the admin-read Edge Function) may call these functions.

-- New audited actions for the two new operations.
alter table public.admin_audit_events
  drop constraint if exists admin_audit_events_action_valid;
alter table public.admin_audit_events
  add constraint admin_audit_events_action_valid check (action in (
    'admin.session.check',
    'admin.user.resolve',
    'admin.home_space.list',
    'admin.snapshot.list',
    'admin.snapshot.preview',
    'admin.home_audit.list',
    'admin.audit.list',
    'admin.user.list',
    'admin.stats.read'
  ));

-- "alice@example.com" -> "a***@example.com". Anything without a usable shape -> null.
create or replace function public.admin_mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else
      left(lower(btrim(p_email)), 1)
      || '***@'
      || left(lower(substring(btrim(p_email) from '@([^@]+)$')), 100)
  end;
$$;

-- Users newest first, keyset paged on (created_at, id). Anonymous and soft-deleted Auth
-- users are left out. Returns no raw email, profile text or home content.
create or replace function public.admin_list_users(
  p_after_created_at timestamptz,
  p_after_id uuid,
  p_limit integer
)
returns table (
  id uuid,
  masked_email text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  home_space_count integer,
  account_managed_space_count integer,
  sync_code_space_count integer,
  snapshot_count integer,
  last_snapshot_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.id,
    public.admin_mask_email(u.email),
    u.created_at,
    u.last_sign_in_at,
    coalesce(spaces.total, 0),
    coalesce(spaces.account_managed, 0),
    coalesce(spaces.sync_code, 0),
    coalesce(snapshots.total, 0),
    snapshots.last_created_at
  from auth.users as u
  left join lateral (
    select
      count(*)::integer as total,
      (count(*) filter (where hs.access_mode = 'account-managed'))::integer as account_managed,
      (count(*) filter (where hs.access_mode = 'sync-code'))::integer as sync_code
    from public.home_spaces as hs
    where hs.user_id = u.id
  ) as spaces on true
  left join lateral (
    select count(*)::integer as total, max(s.created_at) as last_created_at
    from public.home_space_snapshots as s
    where s.user_id = u.id
  ) as snapshots on true
  where u.deleted_at is null
    and not coalesce(u.is_anonymous, false)
    and (
      p_after_created_at is null
      or (p_after_id is not null and (u.created_at, u.id) < (p_after_created_at, p_after_id))
    )
  order by u.created_at desc, u.id desc
  limit least(greatest(coalesce(p_limit, 1), 1), 51);
$$;

-- Aggregate counts for the dashboard. Days are UTC calendar days; "last 7 days" means the
-- last 7 * 24 hours (likewise for 30 days). Visitors are distinct anonymous analytics ids that sent home.viewed,
-- so people who turned analytics off are not counted.
create or replace function public.admin_read_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
    bounds as (
      select now() as at, (now() at time zone 'utc')::date as today
    ),
    users as (
      select u.id, u.created_at, u.last_sign_in_at
      from auth.users as u
      where u.deleted_at is null and not coalesce(u.is_anonymous, false)
    ),
    days as (
      select generate_series(b.today - 29, b.today, interval '1 day')::date as day
      from bounds as b
    ),
    views as (
      select e.anonymous_id, e.created_at
      from public.product_analytics_events as e, bounds as b
      where e.event_name = 'home.viewed'
        and e.created_at >= b.at - interval '30 days'
    ),
    saves as (
      select a.user_id, a.created_at
      from public.home_space_audit_events as a, bounds as b
      where a.event_type in ('sync.account_managed_push', 'sync.account_managed_force_push')
        and a.created_at >= b.at - interval '30 days'
    )
  select jsonb_build_object(
    'generatedAt', to_jsonb(b.at),
    'users', jsonb_build_object(
      'total', (select count(*) from users),
      'new7d', (select count(*) from users where created_at >= b.at - interval '7 days'),
      'new30d', (select count(*) from users where created_at >= b.at - interval '30 days'),
      'signedIn7d', (select count(*) from users where last_sign_in_at >= b.at - interval '7 days'),
      'signedIn30d', (select count(*) from users where last_sign_in_at >= b.at - interval '30 days')
    ),
    'homeSpaces', jsonb_build_object(
      'total', (select count(*) from public.home_spaces),
      'accountManaged', (select count(*) from public.home_spaces where access_mode = 'account-managed'),
      'syncCode', (select count(*) from public.home_spaces where access_mode = 'sync-code'),
      'usersWithAccountManaged', (
        select count(distinct user_id) from public.home_spaces where access_mode = 'account-managed'
      )
    ),
    'snapshots', jsonb_build_object(
      'total', (select count(*) from public.home_space_snapshots),
      'last7d', (
        select count(*) from public.home_space_snapshots where created_at >= b.at - interval '7 days'
      )
    ),
    'cloudSaves', jsonb_build_object(
      'users7d', (select count(distinct user_id) from saves where created_at >= b.at - interval '7 days'),
      'users30d', (select count(distinct user_id) from saves)
    ),
    'visitors', jsonb_build_object(
      'today', (
        select count(distinct anonymous_id) from views
        where created_at >= b.today::timestamp at time zone 'utc'
      ),
      'last7d', (
        select count(distinct anonymous_id) from views where created_at >= b.at - interval '7 days'
      ),
      'last30d', (select count(distinct anonymous_id) from views)
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'date', to_char(d.day, 'YYYY-MM-DD'),
        'newUsers', (
          select count(*) from users
          where (created_at at time zone 'utc')::date = d.day
        ),
        'visitors', (
          select count(distinct anonymous_id) from views
          where (created_at at time zone 'utc')::date = d.day
        )
      ) order by d.day)
      from days as d
    )
  )
  from bounds as b;
$$;

revoke all on function public.admin_mask_email(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_list_users(timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_read_stats()
  from public, anon, authenticated, service_role;

grant execute on function public.admin_mask_email(text) to service_role;
grant execute on function public.admin_list_users(timestamptz, uuid, integer) to service_role;
grant execute on function public.admin_read_stats() to service_role;

commit;
