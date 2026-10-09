-- Verify the RSS proxy cache, rate limit and lease objects plus the rss.feed_checked event.
-- Run after supabase/migrations/022_rss_proxy.sql.
--
-- Writes only rollback-scoped fixtures inside a transaction that always rolls back.
-- Any unexpected result raises, so the deploy runner fails.

begin;

do $$
declare
  v_hash text := repeat('a', 64);
begin
  if to_regclass('public.rss_feed_cache') is null
    or to_regclass('public.rss_rate_limits') is null then
    raise exception 'RSS tables are missing; is migration 022 applied?';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.rss_feed_cache'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.rss_rate_limits'::regclass) then
    raise exception 'RLS is not enabled on the RSS tables';
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public'
    and tablename in ('rss_feed_cache', 'rss_rate_limits')) then
    raise exception 'RSS tables must have no RLS policies';
  end if;

  if has_table_privilege('anon', 'public.rss_feed_cache', 'select')
    or has_table_privilege('authenticated', 'public.rss_feed_cache', 'select')
    or has_table_privilege('anon', 'public.rss_rate_limits', 'insert')
    or has_table_privilege('authenticated', 'public.rss_rate_limits', 'insert') then
    raise exception 'anon or authenticated can reach the RSS tables';
  end if;

  if has_function_privilege('anon', 'public.rss_consume_rate(text, integer, integer)', 'execute')
    or has_function_privilege('authenticated', 'public.rss_consume_rate(text, integer, integer)', 'execute')
    or has_function_privilege('anon', 'public.rss_claim_refresh(text, text, integer)', 'execute')
    or has_function_privilege('authenticated', 'public.rss_claim_refresh(text, text, integer)', 'execute')
    or has_function_privilege('anon', 'public.delete_stale_rss_feed_cache(integer)', 'execute')
    or has_function_privilege('authenticated', 'public.delete_stale_rss_feed_cache(integer)', 'execute') then
    raise exception 'anon or authenticated can execute an RSS function';
  end if;

  if not has_function_privilege('service_role', 'public.rss_consume_rate(text, integer, integer)', 'execute')
    or not has_function_privilege('service_role', 'public.rss_claim_refresh(text, text, integer)', 'execute')
    or not has_function_privilege('service_role', 'public.delete_stale_rss_feed_cache(integer)', 'execute') then
    raise exception 'service_role cannot execute an RSS function';
  end if;

  if not public.rss_consume_rate('verify-024', 86400, 2)
    or not public.rss_consume_rate('verify-024', 86400, 2)
    or public.rss_consume_rate('verify-024', 86400, 2) then
    raise exception 'rss_consume_rate does not enforce its limit';
  end if;

  if not public.rss_claim_refresh(v_hash, 'https://example.com/feed.xml', 60) then
    raise exception 'rss_claim_refresh did not grant the first lease';
  end if;

  if public.rss_claim_refresh(v_hash, 'https://example.com/feed.xml', 60) then
    raise exception 'rss_claim_refresh granted a second concurrent lease';
  end if;

  if not public.product_analytics_event_allowed('rss.feed_checked')
    or not public.product_analytics_properties_allowed('{"result": "ok", "discovered": true}'::jsonb) then
    raise exception 'rss.feed_checked analytics is not allowed; is migration 022 applied?';
  end if;

  if not public.product_analytics_event_allowed('homepage_guide.opened') then
    raise exception 'existing analytics event homepage_guide.opened is no longer allowed';
  end if;

  if public.product_analytics_event_allowed('rss.unknown') then
    raise exception 'unknown analytics event rss.unknown is accepted';
  end if;
end;
$$;

select 'rss proxy objects verified' as result;

rollback;
