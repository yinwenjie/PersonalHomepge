begin;

select plan(7);

select ok(
  public.product_analytics_event_allowed('homepage_guide.opened')
    and public.product_analytics_event_allowed('homepage_guide.address_copied')
    and public.product_analytics_event_allowed('homepage_guide.tip_dismissed'),
  'homepage guide events should be allowed'
);

select ok(
  public.product_analytics_event_allowed('home.viewed'),
  'existing events should stay allowed'
);

select ok(
  not public.product_analytics_event_allowed('homepage_guide.unknown'),
  'unknown events should stay rejected'
);

select ok(
  public.product_analytics_properties_allowed('{"source": "settings", "browserFamily": "chrome"}'::jsonb),
  'browserFamily should be an allowed property'
);

select ok(
  not public.product_analytics_properties_allowed('{"browserVersion": "120"}'::jsonb),
  'unlisted properties should stay rejected'
);

set local role anon;

select lives_ok(
  $$
    select public.record_product_event(
      p_event_name => 'homepage_guide.opened',
      p_anonymous_id => 'anon-homepage-guide-test',
      p_session_id => 'session-homepage-guide-test',
      p_properties => '{"source": "home_tip", "browserFamily": "safari"}'::jsonb
    )
  $$,
  'anon should be able to record a homepage guide event'
);

reset role;

select is(
  (
    select properties ->> 'browserFamily'
    from public.product_analytics_events
    where anonymous_id = 'anon-homepage-guide-test'
      and event_name = 'homepage_guide.opened'
  ),
  'safari',
  'the recorded event should keep its browserFamily'
);

select * from finish();

rollback;
