-- Repair table grants for supabase/migrations/004_account_spaces.sql.
-- Run this only if 004_account_spaces_verify.sql shows overly broad grants,
-- such as TRUNCATE, TRIGGER, or REFERENCES for authenticated.

begin;

revoke all on table public.profiles from anon;
revoke all on table public.account_preferences from anon;
revoke all on table public.home_spaces from anon;

revoke all on table public.profiles from public;
revoke all on table public.account_preferences from public;
revoke all on table public.home_spaces from public;

revoke all on table public.profiles from authenticated;
revoke all on table public.account_preferences from authenticated;
revoke all on table public.home_spaces from authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update on table public.account_preferences to authenticated;
grant select, insert, update, delete on table public.home_spaces to authenticated;

commit;
