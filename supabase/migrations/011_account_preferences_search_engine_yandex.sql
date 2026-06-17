begin;

-- Replace Baidu with Yandex in the account-level default search engine set.
-- Existing Baidu values fall back to DuckDuckGo because Baidu is no longer
-- offered by the settings UI.

update public.account_preferences
set default_search_engine = 'duckduckgo'
where default_search_engine = 'baidu'
   or default_search_engine not in ('duckduckgo', 'google', 'bing', 'yandex');

alter table public.account_preferences
  drop constraint if exists account_preferences_default_search_engine_allowed;

alter table public.account_preferences
  add constraint account_preferences_default_search_engine_allowed
    check (default_search_engine in ('duckduckgo', 'google', 'bing', 'yandex'));

commit;
