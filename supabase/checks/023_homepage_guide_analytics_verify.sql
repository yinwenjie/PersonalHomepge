-- Verify the set-as-homepage guide analytics allowlist.
-- Run after supabase/migrations/021_homepage_guide_analytics.sql.
--
-- Read-only: only calls the immutable allowlist functions, inside a transaction that
-- always rolls back. Any unexpected result raises, so the deploy runner fails.

begin;

do $$
begin
  if not public.product_analytics_event_allowed('homepage_guide.opened')
    or not public.product_analytics_event_allowed('homepage_guide.address_copied')
    or not public.product_analytics_event_allowed('homepage_guide.tip_dismissed') then
    raise exception 'homepage guide analytics events are not allowed; is migration 021 applied?';
  end if;

  if not public.product_analytics_event_allowed('home.viewed') then
    raise exception 'existing analytics event home.viewed is no longer allowed';
  end if;

  if public.product_analytics_event_allowed('homepage_guide.unknown') then
    raise exception 'unknown analytics event homepage_guide.unknown is accepted';
  end if;

  if not public.product_analytics_properties_allowed('{"source": "settings", "browserFamily": "chrome"}'::jsonb) then
    raise exception 'analytics property browserFamily is not allowed; is migration 021 applied?';
  end if;

  if public.product_analytics_properties_allowed('{"browserVersion": "120"}'::jsonb) then
    raise exception 'unlisted analytics property browserVersion is accepted';
  end if;
end;
$$;

select 'homepage guide analytics allowlist verified' as result;

rollback;
