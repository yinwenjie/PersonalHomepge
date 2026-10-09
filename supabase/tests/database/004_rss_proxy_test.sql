begin;

select plan(16);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.rss_feed_cache'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.rss_rate_limits'::regclass),
  'RLS should be enabled on both RSS tables'
);

select ok(
  not has_table_privilege('anon', 'public.rss_feed_cache', 'select')
    and not has_table_privilege('authenticated', 'public.rss_feed_cache', 'select')
    and not has_table_privilege('anon', 'public.rss_rate_limits', 'select')
    and not has_table_privilege('authenticated', 'public.rss_rate_limits', 'select'),
  'anon and authenticated should not read the RSS tables'
);

select ok(
  not has_function_privilege('anon', 'public.rss_consume_rate(text, integer, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.rss_claim_refresh(text, text, integer)', 'execute')
    and not has_function_privilege('anon', 'public.delete_stale_rss_feed_cache(integer)', 'execute'),
  'anon and authenticated should not execute the RSS functions'
);

set local role anon;

select throws_ok(
  $$ select public.rss_consume_rate('anon-bucket', 600, 10) $$,
  '42501',
  null,
  'anon calling rss_consume_rate should be refused'
);

reset role;

set local role service_role;

-- Rate limit: three requests against a limit of two in one window.
select ok(public.rss_consume_rate('test-bucket', 86400, 2), 'first request is within the limit');
select ok(public.rss_consume_rate('test-bucket', 86400, 2), 'second request is within the limit');
select ok(not public.rss_consume_rate('test-bucket', 86400, 2), 'third request is over the limit');
select ok(public.rss_consume_rate('other-bucket', 86400, 2), 'another bucket counts separately');

select throws_ok(
  $$ select public.rss_consume_rate('', 600, 2) $$,
  '22023',
  null,
  'an empty bucket key should be rejected'
);

-- Refresh lease: one winner, then nobody until it expires or the feed is due again.
select ok(
  public.rss_claim_refresh(repeat('b', 64), 'https://example.com/feed.xml', 60),
  'the first caller should get the lease on a new feed'
);

select is(
  (select status from public.rss_feed_cache where url_hash = repeat('b', 64)),
  'pending',
  'a new feed should start as a pending row'
);

select ok(
  not public.rss_claim_refresh(repeat('b', 64), 'https://example.com/feed.xml', 60),
  'a second caller should not get a lease that is still held'
);

update public.rss_feed_cache
set refresh_lease_until = now() - interval '1 second'
where url_hash = repeat('b', 64);

select ok(
  public.rss_claim_refresh(repeat('b', 64), 'https://example.com/feed.xml', 60),
  'an expired lease can be taken again'
);

update public.rss_feed_cache
set refresh_lease_until = null, status = 'ok', next_fetch_at = now() + interval '30 minutes'
where url_hash = repeat('b', 64);

select ok(
  not public.rss_claim_refresh(repeat('b', 64), 'https://example.com/feed.xml', 60),
  'a fresh feed that is not due should not be leased'
);

-- Cleanup removes only feeds nobody asked for in the retention window.
insert into public.rss_feed_cache (url_hash, feed_url, last_requested_at)
values (repeat('c', 64), 'https://example.com/old.xml', now() - interval '31 days');

select is(
  public.delete_stale_rss_feed_cache(30),
  1,
  'cleanup should delete exactly the unused feed'
);

reset role;

select ok(
  public.product_analytics_event_allowed('rss.feed_checked')
    and public.product_analytics_properties_allowed('{"result": "ok", "discovered": true}'::jsonb)
    and public.product_analytics_event_allowed('homepage_guide.opened')
    and not public.product_analytics_event_allowed('rss.unknown'),
  'rss.feed_checked and discovered should be allowed, unknown events still rejected'
);

select * from finish();

rollback;
