begin;

-- Phase 1.15.0: expand account-level locale preferences for i18n v1.
-- This migration only changes the locale check constraint. It does not
-- change RLS policies, grants, default_space_id, home spaces, or sync data.

update public.account_preferences
set locale = case
  when locale in ('system', 'zh-CN', 'zh-TW', 'en-US', 'fr-FR', 'es-ES', 'ja-JP', 'ko-KR', 'it-IT') then locale
  else 'zh-CN'
end;

alter table public.account_preferences
  alter column locale set default 'zh-CN';

alter table public.account_preferences
  drop constraint if exists account_preferences_locale_not_empty,
  drop constraint if exists account_preferences_locale_allowed;

alter table public.account_preferences
  add constraint account_preferences_locale_allowed
    check (locale in ('system', 'zh-CN', 'zh-TW', 'en-US', 'fr-FR', 'es-ES', 'ja-JP', 'ko-KR', 'it-IT'));

commit;
