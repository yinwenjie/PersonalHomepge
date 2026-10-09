-- Verify the set-as-homepage guide analytics allowlist.
-- Run after supabase/migrations/021_homepage_guide_analytics.sql.
--
-- Read-only: only calls the immutable allowlist functions, inside a transaction that
-- always rolls back.

begin;

select
  public.product_analytics_event_allowed('homepage_guide.opened') as opened_allowed,
  public.product_analytics_event_allowed('homepage_guide.address_copied') as address_copied_allowed,
  public.product_analytics_event_allowed('homepage_guide.tip_dismissed') as tip_dismissed_allowed,
  public.product_analytics_event_allowed('home.viewed') as existing_event_allowed,
  public.product_analytics_event_allowed('homepage_guide.unknown') as unknown_event_allowed,
  public.product_analytics_properties_allowed('{"source": "settings", "browserFamily": "chrome"}'::jsonb) as browser_family_allowed,
  public.product_analytics_properties_allowed('{"browserVersion": "120"}'::jsonb) as unlisted_property_allowed;

-- Expected: exactly one row; every column true except unknown_event_allowed and
-- unlisted_property_allowed, which must be false.

rollback;
