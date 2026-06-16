begin;

-- Phase 1.6.6: editable account-level UI preferences.
-- This migration only extends account_preferences. It does not change
-- default_space_id, RLS policies, grants, or home-space ownership rules.

alter table public.account_preferences
  add column if not exists font_family text not null default 'system',
  add column if not exists density text not null default 'comfortable',
  add column if not exists default_search_engine text not null default 'duckduckgo';

alter table public.account_preferences
  alter column font_family set default 'system',
  alter column density set default 'comfortable',
  alter column default_search_engine set default 'duckduckgo';

update public.account_preferences
set
  locale = case when locale in ('zh-CN', 'en-US') then locale else 'zh-CN' end,
  theme_preference = case when theme_preference in ('system', 'light', 'dark') then theme_preference else 'system' end,
  font_family = case when font_family in ('system', 'serif', 'mono') then font_family else 'system' end,
  density = case when density in ('comfortable', 'compact') then density else 'comfortable' end,
  default_search_engine = case when default_search_engine in ('duckduckgo', 'google', 'bing', 'baidu') then default_search_engine else 'duckduckgo' end;

alter table public.account_preferences
  alter column font_family set not null,
  alter column density set not null,
  alter column default_search_engine set not null;

alter table public.account_preferences
  drop constraint if exists account_preferences_locale_not_empty,
  drop constraint if exists account_preferences_theme_preference_not_empty,
  drop constraint if exists account_preferences_locale_allowed,
  drop constraint if exists account_preferences_theme_preference_allowed,
  drop constraint if exists account_preferences_font_family_allowed,
  drop constraint if exists account_preferences_density_allowed,
  drop constraint if exists account_preferences_default_search_engine_allowed;

alter table public.account_preferences
  add constraint account_preferences_locale_allowed
    check (locale in ('zh-CN', 'en-US')),
  add constraint account_preferences_theme_preference_allowed
    check (theme_preference in ('system', 'light', 'dark')),
  add constraint account_preferences_font_family_allowed
    check (font_family in ('system', 'serif', 'mono')),
  add constraint account_preferences_density_allowed
    check (density in ('comfortable', 'compact')),
  add constraint account_preferences_default_search_engine_allowed
    check (default_search_engine in ('duckduckgo', 'google', 'bing', 'baidu'));

commit;
